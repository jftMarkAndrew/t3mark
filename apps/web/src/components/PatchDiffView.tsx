import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useMemo } from "react";

import { useTheme } from "../hooks/useTheme";
import { useSettings } from "../hooks/useSettings";
import { buildPatchCacheKey, resolveDiffThemeName } from "../lib/diffRendering";
import { resolvePathLinkTarget } from "../terminal-links";
import { readNativeApi } from "../nativeApi";
import { openInPreferredEditor } from "../editorPreferences";
import { cn } from "~/lib/utils";

type DiffThemeType = "light" | "dark";

export const PATCH_DIFF_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(patch: string | undefined, cacheScope: string): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

export function PatchDiffView(props: { patch: string; cacheScope: string; cwd: string | null }) {
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const renderablePatch = useMemo(
    () => getRenderablePatch(props.patch, `${props.cacheScope}:${resolvedTheme}`),
    [props.cacheScope, props.patch, resolvedTheme],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);

  if (!renderablePatch) {
    return (
      <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
        <p>No patch available for this selection.</p>
      </div>
    );
  }

  if (renderablePatch.kind === "raw") {
    return (
      <div className="h-full overflow-auto p-2">
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
          <pre
            className={cn(
              "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
              settings.diffWordWrap
                ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                : "overflow-auto",
            )}
          >
            {renderablePatch.text}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <Virtualizer
      className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
      config={{
        overscrollSize: 600,
        intersectionObserverMargin: 1200,
      }}
    >
      {renderableFiles.map((fileDiff) => {
        const filePath = resolveFileDiffPath(fileDiff);
        const fileKey = buildFileDiffRenderKey(fileDiff);
        const themedFileKey = `${fileKey}:${resolvedTheme}`;
        return (
          <div
            key={themedFileKey}
            data-diff-file-path={filePath}
            className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
            onClickCapture={(event) => {
              const nativeEvent = event.nativeEvent as MouseEvent;
              const composedPath = nativeEvent.composedPath?.() ?? [];
              const clickedHeader = composedPath.some((node) => {
                if (!(node instanceof Element)) return false;
                return node.hasAttribute("data-title");
              });
              if (!clickedHeader) return;
              const api = readNativeApi();
              if (!api) return;
              const targetPath = props.cwd ? resolvePathLinkTarget(filePath, props.cwd) : filePath;
              void openInPreferredEditor(api, targetPath).catch(() => undefined);
            }}
          >
            <FileDiff
              fileDiff={fileDiff}
              options={{
                diffStyle: "unified",
                lineDiffType: "none",
                overflow: settings.diffWordWrap ? "wrap" : "scroll",
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme as DiffThemeType,
                unsafeCSS: PATCH_DIFF_UNSAFE_CSS,
              }}
            />
          </div>
        );
      })}
    </Virtualizer>
  );
}
