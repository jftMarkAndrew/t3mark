import {
  type DaytonaServerStatus,
  type EditorId,
  type ProjectBootstrapConfig,
  type ProjectDaytonaConfig,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import {
  AlertTriangleIcon,
  CloudIcon,
  DiffIcon,
  RocketIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectBootstrapInput,
  type NewProjectDaytonaInput,
  type NewProjectScriptInput,
} from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  activeProjectBootstrap: ProjectBootstrapConfig | null;
  activeProjectDaytona: ProjectDaytonaConfig | null;
  daytonaServerStatus: DaytonaServerStatus | null;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  localhostLauncherScript: ProjectScript | null;
  localhostLauncherDisabledReason: string | null;
  localhostLauncherLabel: string;
  daytonaDisabledReason: string | null;
  daytonaTooltip: string;
  daytonaLabel: string;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onSaveProjectBootstrap: (input: NewProjectBootstrapInput) => Promise<void>;
  onSaveProjectDaytona: (input: NewProjectDaytonaInput) => Promise<void>;
  onRunLocalhostLauncher: () => void;
  onRunDaytona: () => void;
  bootstrapStatus: "idle" | "running" | "ready" | "failed" | null;
  bootstrapError: string | null;
  onRetryBootstrap: () => void;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectCwd,
  activeProjectScripts,
  activeProjectBootstrap,
  activeProjectDaytona,
  daytonaServerStatus,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  localhostLauncherScript,
  localhostLauncherDisabledReason,
  localhostLauncherLabel,
  daytonaDisabledReason,
  daytonaTooltip,
  daytonaLabel,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onSaveProjectBootstrap,
  onSaveProjectDaytona,
  onRunLocalhostLauncher,
  onRunDaytona,
  bootstrapStatus,
  bootstrapError,
  onRetryBootstrap,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const daytonaFailed = daytonaLabel === "Daytona Failed";

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            projectCwd={activeProjectCwd ?? ""}
            bootstrap={activeProjectBootstrap}
            daytona={activeProjectDaytona}
            daytonaServerStatus={daytonaServerStatus}
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
            onSaveBootstrap={onSaveProjectBootstrap}
            onSaveDaytona={onSaveProjectDaytona}
          />
        )}
        {bootstrapStatus ? (
          bootstrapStatus === "failed" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    className="shrink-0"
                    variant="outline"
                    size="xs"
                    onClick={onRetryBootstrap}
                  >
                    <AlertTriangleIcon className="size-3" />
                    <span>Bootstrap failed</span>
                  </Button>
                }
              />
              <TooltipPopup side="bottom">
                {bootstrapError ?? "Bootstrap failed. Click to retry."}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <Badge variant="outline" className="shrink-0">
              {bootstrapStatus === "running"
                ? "Preparing"
                : bootstrapStatus === "ready"
                  ? "Ready"
                  : "Idle"}
            </Badge>
          )
        ) : null}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />}
        {localhostLauncherScript ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="shrink-0"
                  variant="outline"
                  size="xs"
                  onClick={onRunLocalhostLauncher}
                  disabled={localhostLauncherDisabledReason !== null}
                  title={localhostLauncherScript.name}
                >
                  <RocketIcon className="size-3" />
                  <span>{localhostLauncherLabel}</span>
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              {localhostLauncherDisabledReason ?? localhostLauncherScript.command}
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {activeProjectDaytona?.enabled ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="shrink-0"
                  variant={daytonaFailed ? "destructive" : "outline"}
                  size="xs"
                  onClick={onRunDaytona}
                  disabled={daytonaDisabledReason !== null}
                  title="Daytona preview"
                >
                  {daytonaFailed ? (
                    <AlertTriangleIcon className="size-3" />
                  ) : (
                    <CloudIcon className="size-3" />
                  )}
                  <span>{daytonaLabel}</span>
                </Button>
              }
            />
            <TooltipPopup side="bottom">{daytonaDisabledReason ?? daytonaTooltip}</TooltipPopup>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
