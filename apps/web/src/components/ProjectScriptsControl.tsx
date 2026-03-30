import type {
  BootstrapPackageManager,
  CredentialProfile,
  ProjectBootstrapConfig,
  ProjectDaytonaConfig,
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  DaytonaServerStatus,
} from "@t3tools/contracts";
import {
  BugIcon,
  ChevronDownIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  PlusIcon,
  RocketIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import React, { type FormEvent, type KeyboardEvent, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { projectDetectBootstrapQueryOptions } from "~/lib/projectReactQuery";
import {
  commandForProjectScript,
  DEFAULT_LOCALHOST_BASE_PORT,
  nextProjectScriptId,
  projectScriptContainsPortPlaceholder,
  primaryProjectScript,
} from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import { isMacPlatform } from "~/lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Group, GroupSeparator } from "./ui/group";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  runAsLocalhostLauncher: boolean;
  localhostBasePort: number | null;
  keybinding: string | null;
}

export interface NewProjectBootstrapInput {
  enabled: boolean;
  installCommand: string | null;
  devCommand: string | null;
  detectedPackageManager: BootstrapPackageManager | null;
}

export interface NewProjectDaytonaInput {
  enabled: boolean;
  repoUrl: string | null;
  defaultBranch: string | null;
  installCommand: string | null;
  devCommand: string | null;
  previewPort: number | null;
  daytonaCredentialProfileId: string | null;
  gitCredentialProfileId: string | null;
}

interface ProjectScriptsControlProps {
  projectCwd: string;
  bootstrap: ProjectBootstrapConfig | null;
  daytona: ProjectDaytonaConfig | null;
  daytonaServerStatus?: DaytonaServerStatus | null;
  scripts: ProjectScript[];
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<void> | void;
  onUpdateScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void> | void;
  onDeleteScript: (scriptId: string) => Promise<void> | void;
  onSaveBootstrap: (input: NewProjectBootstrapInput) => Promise<void> | void;
  onSaveDaytona: (input: NewProjectDaytonaInput) => Promise<void> | void;
}

function normalizeShortcutKeyToken(key: string): string | null {
  const normalized = key.toLowerCase();
  if (
    normalized === "meta" ||
    normalized === "control" ||
    normalized === "ctrl" ||
    normalized === "shift" ||
    normalized === "alt" ||
    normalized === "option"
  ) {
    return null;
  }
  if (normalized === " ") return "space";
  if (normalized === "escape") return "esc";
  if (normalized === "arrowup") return "arrowup";
  if (normalized === "arrowdown") return "arrowdown";
  if (normalized === "arrowleft") return "arrowleft";
  if (normalized === "arrowright") return "arrowright";
  if (normalized.length === 1) return normalized;
  if (normalized.startsWith("f") && normalized.length <= 3) return normalized;
  if (normalized === "enter" || normalized === "tab" || normalized === "backspace") {
    return normalized;
  }
  if (normalized === "delete" || normalized === "home" || normalized === "end") {
    return normalized;
  }
  if (normalized === "pageup" || normalized === "pagedown") return normalized;
  return null;
}

function keybindingFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const keyToken = normalizeShortcutKeyToken(event.key);
  if (!keyToken) return null;

  const parts: string[] = [];
  if (isMacPlatform(navigator.platform)) {
    if (event.metaKey) parts.push("mod");
    if (event.ctrlKey) parts.push("ctrl");
  } else {
    if (event.ctrlKey) parts.push("mod");
    if (event.metaKey) parts.push("meta");
  }
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (parts.length === 0) {
    return null;
  }
  parts.push(keyToken);
  return parts.join("+");
}

export default function ProjectScriptsControl({
  projectCwd,
  bootstrap,
  daytona,
  daytonaServerStatus = null,
  scripts,
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  onSaveBootstrap,
  onSaveDaytona,
}: ProjectScriptsControlProps) {
  const addScriptFormId = React.useId();
  const bootstrapFormId = React.useId();
  const daytonaFormId = React.useId();
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bootstrapDialogOpen, setBootstrapDialogOpen] = useState(false);
  const [daytonaDialogOpen, setDaytonaDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [runAsLocalhostLauncher, setRunAsLocalhostLauncher] = useState(false);
  const [localhostBasePort, setLocalhostBasePort] = useState(String(DEFAULT_LOCALHOST_BASE_PORT));
  const [keybinding, setKeybinding] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [bootstrapEnabled, setBootstrapEnabled] = useState(false);
  const [bootstrapInstallCommand, setBootstrapInstallCommand] = useState("");
  const [bootstrapDevCommand, setBootstrapDevCommand] = useState("");
  const [bootstrapPackageManager, setBootstrapPackageManager] =
    useState<BootstrapPackageManager | null>(null);
  const [bootstrapValidationError, setBootstrapValidationError] = useState<string | null>(null);
  const [daytonaEnabled, setDaytonaEnabled] = useState(false);
  const [daytonaRepoUrl, setDaytonaRepoUrl] = useState("");
  const [daytonaDefaultBranch, setDaytonaDefaultBranch] = useState("");
  const [daytonaInstallCommand, setDaytonaInstallCommand] = useState("");
  const [daytonaDevCommand, setDaytonaDevCommand] = useState("");
  const [daytonaPreviewPort, setDaytonaPreviewPort] = useState(String(DEFAULT_LOCALHOST_BASE_PORT));
  const [daytonaCredentialMode, setDaytonaCredentialMode] = useState<"default" | "profile">(
    "default",
  );
  const [daytonaCredentialProfileId, setDaytonaCredentialProfileId] = useState("__default__");
  const [gitCredentialMode, setGitCredentialMode] = useState<"default" | "profile">("default");
  const [gitCredentialProfileId, setGitCredentialProfileId] = useState("__default__");
  const [daytonaValidationError, setDaytonaValidationError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const navigate = useNavigate();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const bootstrapDetectionQuery = useQuery(
    projectDetectBootstrapQueryOptions({
      cwd: projectCwd,
      enabled: bootstrapDialogOpen || daytonaDialogOpen || bootstrap === null,
    }),
  );

  React.useEffect(() => {
    if (!daytonaDialogOpen) {
      return;
    }
    const detected = bootstrapDetectionQuery.data;
    if (!detected) {
      return;
    }

    if (daytona?.repoUrl == null || daytona.repoUrl.trim().length === 0) {
      setDaytonaRepoUrl((current) => current || detected.detectedRepoUrl || "");
    }
    if (daytona?.defaultBranch == null || daytona.defaultBranch.trim().length === 0) {
      setDaytonaDefaultBranch((current) => current || detected.detectedDefaultBranch || "");
    }
    if (daytona?.installCommand == null || daytona.installCommand.trim().length === 0) {
      setDaytonaInstallCommand(
        (current) => current || detected.detectedDaytonaInstallCommand || "",
      );
    }
    if (daytona?.devCommand == null || daytona.devCommand.trim().length === 0) {
      setDaytonaDevCommand((current) => current || detected.detectedDaytonaDevCommand || "");
    }
    if (daytona?.previewPort == null) {
      setDaytonaPreviewPort((current) =>
        current === String(DEFAULT_LOCALHOST_BASE_PORT) && detected.detectedAppPort
          ? String(detected.detectedAppPort)
          : current,
      );
    }
  }, [bootstrapDetectionQuery.data, daytona, daytonaDialogOpen]);

  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const isEditing = editingScriptId !== null;
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromEvent(event);
    if (!next) return;
    setKeybinding(next);
  };

  const submitAddScript = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }
    const parsedLocalhostBasePort = runAsLocalhostLauncher
      ? Number.parseInt(localhostBasePort, 10)
      : null;
    if (runAsLocalhostLauncher && !projectScriptContainsPortPlaceholder(trimmedCommand)) {
      setValidationError('Localhost launcher commands must include "{{port}}".');
      return;
    }
    if (
      runAsLocalhostLauncher &&
      (!Number.isInteger(parsedLocalhostBasePort) || (parsedLocalhostBasePort ?? 0) < 0)
    ) {
      setValidationError("Base port must be an integer greater than or equal to 0.");
      return;
    }

    setValidationError(null);
    try {
      const scriptIdForValidation =
        editingScriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        runAsLocalhostLauncher,
        localhostBasePort: runAsLocalhostLauncher ? parsedLocalhostBasePort : null,
        keybinding: keybindingRule?.key ?? null,
      } satisfies NewProjectScriptInput;
      if (editingScriptId) {
        await onUpdateScript(editingScriptId, payload);
      } else {
        await onAddScript(payload);
      }
      setDialogOpen(false);
      setIconPickerOpen(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    }
  };

  const openAddDialog = () => {
    setEditingScriptId(null);
    setName("");
    setCommand("");
    setIcon("play");
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(false);
    setRunAsLocalhostLauncher(false);
    setLocalhostBasePort(String(DEFAULT_LOCALHOST_BASE_PORT));
    setKeybinding("");
    setValidationError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (script: ProjectScript) => {
    setEditingScriptId(script.id);
    setName(script.name);
    setCommand(script.command);
    setIcon(script.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(script.runOnWorktreeCreate);
    setRunAsLocalhostLauncher(script.runAsLocalhostLauncher ?? false);
    setLocalhostBasePort(String(script.localhostBasePort ?? DEFAULT_LOCALHOST_BASE_PORT));
    setKeybinding(keybindingValueForCommand(keybindings, commandForProjectScript(script.id)) ?? "");
    setValidationError(null);
    setDialogOpen(true);
  };

  const confirmDeleteScript = useCallback(() => {
    if (!editingScriptId) return;
    setDeleteConfirmOpen(false);
    setDialogOpen(false);
    void onDeleteScript(editingScriptId);
  }, [editingScriptId, onDeleteScript]);

  const openBootstrapDialog = useCallback(() => {
    const detected = bootstrapDetectionQuery.data;
    setBootstrapEnabled(bootstrap?.enabled ?? detected?.enabled ?? false);
    setBootstrapInstallCommand(bootstrap?.installCommand ?? detected?.installCommand ?? "");
    setBootstrapDevCommand(bootstrap?.devCommand ?? detected?.devCommand ?? "");
    setBootstrapPackageManager(
      bootstrap?.detectedPackageManager ?? detected?.detectedPackageManager ?? null,
    );
    setBootstrapValidationError(null);
    setBootstrapDialogOpen(true);
  }, [bootstrap, bootstrapDetectionQuery.data]);

  const submitBootstrap = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const nextInstallCommand = bootstrapInstallCommand.trim();
      const nextDevCommand = bootstrapDevCommand.trim();
      if (bootstrapEnabled && nextInstallCommand.length === 0) {
        setBootstrapValidationError("Bootstrap install command is required when enabled.");
        return;
      }
      if (nextDevCommand.length > 0 && !projectScriptContainsPortPlaceholder(nextDevCommand)) {
        setBootstrapValidationError('Bootstrap localhost command must include "{{port}}".');
        return;
      }
      setBootstrapValidationError(null);
      await onSaveBootstrap({
        enabled: bootstrapEnabled,
        installCommand: nextInstallCommand.length > 0 ? nextInstallCommand : null,
        devCommand: nextDevCommand.length > 0 ? nextDevCommand : null,
        detectedPackageManager: bootstrapPackageManager,
      });
      setBootstrapDialogOpen(false);
    },
    [
      bootstrapDevCommand,
      bootstrapEnabled,
      bootstrapInstallCommand,
      bootstrapPackageManager,
      onSaveBootstrap,
    ],
  );

  const openDaytonaDialog = useCallback(() => {
    const detected = bootstrapDetectionQuery.data;
    setDaytonaEnabled(daytona?.enabled ?? false);
    setDaytonaRepoUrl(daytona?.repoUrl ?? detected?.detectedRepoUrl ?? "");
    setDaytonaDefaultBranch(daytona?.defaultBranch ?? detected?.detectedDefaultBranch ?? "");
    setDaytonaInstallCommand(
      daytona?.installCommand ?? detected?.detectedDaytonaInstallCommand ?? "",
    );
    setDaytonaDevCommand(daytona?.devCommand ?? detected?.detectedDaytonaDevCommand ?? "");
    setDaytonaPreviewPort(
      String(daytona?.previewPort ?? detected?.detectedAppPort ?? DEFAULT_LOCALHOST_BASE_PORT),
    );
    setDaytonaCredentialMode(daytona?.daytonaCredentialProfileId ? "profile" : "default");
    setDaytonaCredentialProfileId(daytona?.daytonaCredentialProfileId ?? "__default__");
    setGitCredentialMode(daytona?.gitCredentialProfileId ? "profile" : "default");
    setGitCredentialProfileId(daytona?.gitCredentialProfileId ?? "__default__");
    setDaytonaValidationError(null);
    setDaytonaDialogOpen(true);
  }, [bootstrapDetectionQuery.data, daytona]);

  const submitDaytona = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const nextRepoUrl = daytonaRepoUrl.trim();
      const nextDefaultBranch = daytonaDefaultBranch.trim();
      const nextInstallCommand = daytonaInstallCommand.trim();
      const nextDevCommand = daytonaDevCommand.trim();
      const parsedPreviewPort = Number.parseInt(daytonaPreviewPort, 10);

      if (daytonaEnabled && nextRepoUrl.length === 0) {
        setDaytonaValidationError(
          "Repository URL is required because Daytona clones the repo inside the sandbox.",
        );
        return;
      }
      if (daytonaEnabled && nextDefaultBranch.length === 0) {
        setDaytonaValidationError(
          "Default branch is required when Daytona is enabled and the thread has no branch.",
        );
        return;
      }
      if (!Number.isInteger(parsedPreviewPort) || parsedPreviewPort <= 0) {
        setDaytonaValidationError("App port must be a positive integer.");
        return;
      }

      setDaytonaValidationError(null);
      await onSaveDaytona({
        enabled: daytonaEnabled,
        repoUrl: nextRepoUrl.length > 0 ? nextRepoUrl : null,
        defaultBranch: nextDefaultBranch.length > 0 ? nextDefaultBranch : null,
        installCommand: nextInstallCommand.length > 0 ? nextInstallCommand : null,
        devCommand: nextDevCommand.length > 0 ? nextDevCommand : null,
        previewPort: parsedPreviewPort,
        daytonaCredentialProfileId:
          daytonaCredentialMode === "profile" && daytonaCredentialProfileId !== "__default__"
            ? daytonaCredentialProfileId
            : null,
        gitCredentialProfileId:
          gitCredentialMode === "profile" && gitCredentialProfileId !== "__default__"
            ? gitCredentialProfileId
            : null,
      });
      setDaytonaDialogOpen(false);
    },
    [
      daytonaCredentialMode,
      daytonaDefaultBranch,
      daytonaCredentialProfileId,
      daytonaDevCommand,
      daytonaEnabled,
      gitCredentialMode,
      gitCredentialProfileId,
      daytonaInstallCommand,
      daytonaPreviewPort,
      daytonaRepoUrl,
      onSaveDaytona,
    ],
  );

  const credentialProfiles = serverConfigQuery.data?.credentials?.profiles ?? [];
  const daytonaProfiles = credentialProfiles.filter(
    (profile): profile is CredentialProfile => profile.kind === "daytona",
  );
  const githubProfiles = credentialProfiles.filter(
    (profile): profile is CredentialProfile => profile.kind === "github",
  );

  return (
    <>
      {primaryScript ? (
        <Group aria-label="Project scripts">
          <Button
            size="xs"
            variant="outline"
            onClick={() => onRunScript(primaryScript)}
            title={`Run ${primaryScript.name}`}
          >
            <ScriptIcon icon={primaryScript.icon} />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              {primaryScript.name}
            </span>
          </Button>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <MenuItem
                    key={script.id}
                    className={`group ${dropdownItemClassName}`}
                    onClick={() => onRunScript(script)}
                  >
                    <ScriptIcon icon={script.icon} className="size-4" />
                    <span className="truncate">
                      {script.runOnWorktreeCreate
                        ? `${script.name} (setup)`
                        : script.runAsLocalhostLauncher
                          ? `${script.name} (localhost)`
                          : script.name}
                    </span>
                    <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
                      {shortcutLabel && (
                        <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                          {shortcutLabel}
                        </MenuShortcut>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditDialog(script);
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    </span>
                  </MenuItem>
                );
              })}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
              <MenuItem className={dropdownItemClassName} onClick={openBootstrapDialog}>
                <RocketIcon className="size-4" />
                Configure bootstrap
              </MenuItem>
              <MenuItem className={dropdownItemClassName} onClick={openDaytonaDialog}>
                <RocketIcon className="size-4" />
                Configure Daytona
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : (
        <Group aria-label="Project scripts">
          <Button size="xs" variant="outline" onClick={openAddDialog} title="Add action">
            <PlusIcon className="size-3.5" />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              Add action
            </span>
          </Button>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu highlightItemOnHover={false}>
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
              <MenuItem className={dropdownItemClassName} onClick={openBootstrapDialog}>
                <RocketIcon className="size-4" />
                Configure bootstrap
              </MenuItem>
              <MenuItem className={dropdownItemClassName} onClick={openDaytonaDialog}>
                <RocketIcon className="size-4" />
                Configure Daytona
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      )}

      <Dialog
        open={daytonaDialogOpen}
        onOpenChange={(open) => {
          setDaytonaDialogOpen(open);
          if (!open) {
            setDaytonaValidationError(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Daytona</DialogTitle>
            <DialogDescription>
              Configure remote preview workspaces for this project.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={daytonaFormId} className="space-y-4" onSubmit={submitDaytona}>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Enable Daytona previews</span>
                <Switch
                  checked={daytonaEnabled}
                  onCheckedChange={(checked) => setDaytonaEnabled(Boolean(checked))}
                />
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-server-status">Server status</Label>
                <Input
                  id="daytona-server-status"
                  value={
                    daytonaServerStatus?.configured
                      ? `Ready${daytonaServerStatus.target ? ` (${daytonaServerStatus.target})` : ""}`
                      : "Unavailable"
                  }
                  readOnly
                />
                {daytonaServerStatus?.message ? (
                  <p className="text-xs text-muted-foreground">{daytonaServerStatus.message}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-repo-url">Repository URL</Label>
                <Input
                  id="daytona-repo-url"
                  value={daytonaRepoUrl}
                  placeholder={
                    bootstrapDetectionQuery.data?.detectedRepoUrl ??
                    "https://github.com/owner/repo.git"
                  }
                  onChange={(event) => setDaytonaRepoUrl(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Daytona clones this repository into the sandbox before starting the preview.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-default-branch">Default branch</Label>
                <Input
                  id="daytona-default-branch"
                  value={daytonaDefaultBranch}
                  placeholder={bootstrapDetectionQuery.data?.detectedDefaultBranch ?? "main"}
                  onChange={(event) => setDaytonaDefaultBranch(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used when the active thread does not already have a branch.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-install-command">Install command override</Label>
                <Input
                  id="daytona-install-command"
                  value={daytonaInstallCommand}
                  placeholder={
                    bootstrapDetectionQuery.data?.detectedDaytonaInstallCommand ?? "bun install"
                  }
                  onChange={(event) => setDaytonaInstallCommand(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-dev-command">Dev command</Label>
                <Input
                  id="daytona-dev-command"
                  value={daytonaDevCommand}
                  placeholder={
                    bootstrapDetectionQuery.data?.detectedDaytonaDevCommand ?? "bun run dev"
                  }
                  onChange={(event) => setDaytonaDevCommand(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Runs normally inside Daytona. Angular apps should bind to `0.0.0.0` for remote
                  previews. The app port below is only used to open the preview.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-preview-port">App port</Label>
                <Input
                  id="daytona-preview-port"
                  inputMode="numeric"
                  value={daytonaPreviewPort}
                  placeholder={String(
                    bootstrapDetectionQuery.data?.detectedAppPort ?? DEFAULT_LOCALHOST_BASE_PORT,
                  )}
                  onChange={(event) => setDaytonaPreviewPort(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Daytona uses this port to generate the preview URL after your app starts.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="daytona-credential-profile">Daytona credentials</Label>
                <RadioGroup
                  value={daytonaCredentialMode}
                  onValueChange={(value) =>
                    setDaytonaCredentialMode(value === "profile" ? "profile" : "default")
                  }
                  className="gap-2"
                >
                  <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <RadioGroupItem value="default" />
                    <span>Use default Daytona credentials or `.env`</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <RadioGroupItem value="profile" />
                    <span>Use project-specific Daytona credentials</span>
                  </label>
                </RadioGroup>
                {daytonaCredentialMode === "profile" ? (
                  daytonaProfiles.length > 0 ? (
                    <Select
                      value={
                        daytonaCredentialProfileId === "__default__"
                          ? (daytonaProfiles[0]?.id ?? null)
                          : daytonaCredentialProfileId
                      }
                      onValueChange={(value) =>
                        setDaytonaCredentialProfileId(
                          value ?? daytonaProfiles[0]?.id ?? "__default__",
                        )
                      }
                    >
                      <SelectTrigger id="daytona-credential-profile" className="w-full">
                        <SelectValue>
                          {daytonaProfiles.find(
                            (profile) => profile.id === daytonaCredentialProfileId,
                          )?.name ?? "Select Daytona credentials"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {daytonaProfiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                            {profile.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                      No saved Daytona profiles yet.
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="ml-2 h-auto px-1 py-0"
                        onClick={() => void navigate({ to: "/settings" })}
                      >
                        Open Settings
                      </Button>
                    </div>
                  )
                ) : null}
                <p className="text-xs text-muted-foreground">
                  This is the explicit folder-level override. Keep the default path, or select a
                  saved Daytona profile just for this project.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="git-credential-profile">Git credentials</Label>
                <RadioGroup
                  value={gitCredentialMode}
                  onValueChange={(value) =>
                    setGitCredentialMode(value === "profile" ? "profile" : "default")
                  }
                  className="gap-2"
                >
                  <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <RadioGroupItem value="default" />
                    <span>Use default GitHub credentials or `.env`</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm">
                    <RadioGroupItem value="profile" />
                    <span>Use project-specific GitHub credentials</span>
                  </label>
                </RadioGroup>
                {gitCredentialMode === "profile" ? (
                  githubProfiles.length > 0 ? (
                    <Select
                      value={
                        gitCredentialProfileId === "__default__"
                          ? (githubProfiles[0]?.id ?? null)
                          : gitCredentialProfileId
                      }
                      onValueChange={(value) =>
                        setGitCredentialProfileId(value ?? githubProfiles[0]?.id ?? "__default__")
                      }
                    >
                      <SelectTrigger id="git-credential-profile" className="w-full">
                        <SelectValue>
                          {githubProfiles.find((profile) => profile.id === gitCredentialProfileId)
                            ?.name ?? "Select GitHub credentials"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {githubProfiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                            {profile.isDefault ? " (default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                      No saved GitHub profiles yet.
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="ml-2 h-auto px-1 py-0"
                        onClick={() => void navigate({ to: "/settings" })}
                      >
                        Open Settings
                      </Button>
                    </div>
                  )
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Used for cloning private GitHub repositories inside Daytona. Keep the default
                  GitHub credentials, or override them for this folder only.
                </p>
              </div>
              {daytonaValidationError ? (
                <p className="text-sm text-destructive">{daytonaValidationError}</p>
              ) : null}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDaytonaDialogOpen(false)}>
              Cancel
            </Button>
            <Button form={daytonaFormId} type="submit">
              Save Daytona
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={bootstrapDialogOpen}
        onOpenChange={(open) => {
          setBootstrapDialogOpen(open);
          if (!open) {
            setBootstrapValidationError(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Bootstrap</DialogTitle>
            <DialogDescription>
              Auto-prepare managed worktrees before localhost launches.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={bootstrapFormId} className="space-y-4" onSubmit={submitBootstrap}>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Enable worktree bootstrap</span>
                <Switch
                  checked={bootstrapEnabled}
                  onCheckedChange={(checked) => setBootstrapEnabled(Boolean(checked))}
                />
              </label>
              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-package-manager">Detected package manager</Label>
                <Input
                  id="bootstrap-package-manager"
                  value={bootstrapPackageManager ?? ""}
                  placeholder="Not detected"
                  readOnly
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-install-command">Install command</Label>
                <Input
                  id="bootstrap-install-command"
                  value={bootstrapInstallCommand}
                  placeholder="npm ci"
                  onChange={(event) => setBootstrapInstallCommand(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-dev-command">Detected localhost command</Label>
                <Input
                  id="bootstrap-dev-command"
                  value={bootstrapDevCommand}
                  placeholder="npm run dev -- --port {{port}}"
                  onChange={(event) => setBootstrapDevCommand(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Used as the default localhost command when no dedicated localhost action exists.
                </p>
              </div>
              {bootstrapValidationError ? (
                <p className="text-sm text-destructive">{bootstrapValidationError}</p>
              ) : null}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBootstrapDialogOpen(false)}>
              Cancel
            </Button>
            <Button form={bootstrapFormId} type="submit">
              Save bootstrap
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setIconPickerOpen(false);
          }
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          setEditingScriptId(null);
          setName("");
          setCommand("");
          setIcon("play");
          setRunOnWorktreeCreate(false);
          setRunAsLocalhostLauncher(false);
          setLocalhostBasePort(String(DEFAULT_LOCALHOST_BASE_PORT));
          setKeybinding("");
          setValidationError(null);
        }}
        open={dialogOpen}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Action" : "Add Action"}</DialogTitle>
            <DialogDescription>
              Actions are project-scoped commands you can run from the top bar or keybindings.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={addScriptFormId} className="space-y-4" onSubmit={submitAddScript}>
              <div className="space-y-1.5">
                <Label htmlFor="script-name">Name</Label>
                <div className="flex items-center gap-2">
                  <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="size-9 shrink-0 hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)]"
                          aria-label="Choose icon"
                        />
                      }
                    >
                      <ScriptIcon icon={icon} className="size-4.5" />
                    </PopoverTrigger>
                    <PopoverPopup align="start">
                      <div className="grid grid-cols-3 gap-2">
                        {SCRIPT_ICONS.map((entry) => {
                          const isSelected = entry.id === icon;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className={`relative flex flex-col items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                                isSelected
                                  ? "border-primary/70 bg-primary/10"
                                  : "border-border/70 hover:bg-accent/60"
                              }`}
                              onClick={() => {
                                setIcon(entry.id);
                                setIconPickerOpen(false);
                              }}
                            >
                              <ScriptIcon icon={entry.id} className="size-4" />
                              <span>{entry.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverPopup>
                  </Popover>
                  <Input
                    id="script-name"
                    autoFocus
                    placeholder="Test"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-keybinding">Keybinding</Label>
                <Input
                  id="script-keybinding"
                  placeholder="Press shortcut"
                  value={keybinding}
                  readOnly
                  onKeyDown={captureKeybinding}
                />
                <p className="text-xs text-muted-foreground">
                  Press a shortcut. Use <code>Backspace</code> to clear.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-command">Command</Label>
                <Textarea
                  id="script-command"
                  placeholder="bun test"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Run automatically on worktree creation</span>
                <Switch
                  checked={runOnWorktreeCreate}
                  onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Use as localhost launcher</span>
                <Switch
                  checked={runAsLocalhostLauncher}
                  onCheckedChange={(checked) => setRunAsLocalhostLauncher(Boolean(checked))}
                />
              </label>
              {runAsLocalhostLauncher ? (
                <div className="space-y-1.5">
                  <Label htmlFor="script-localhost-base-port">Base port</Label>
                  <Input
                    id="script-localhost-base-port"
                    inputMode="numeric"
                    placeholder={String(DEFAULT_LOCALHOST_BASE_PORT)}
                    value={localhostBasePort}
                    onChange={(event) => setLocalhostBasePort(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Include <code>{"{{port}}"}</code> in the command, for example{" "}
                    <code>npm run dev -- --port {"{{port}}"}</code>.
                  </p>
                </div>
              ) : null}
              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter>
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button form={addScriptFormId} type="submit">
              {isEditing ? "Save changes" : "Save action"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete action "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" onClick={confirmDeleteScript}>
              Delete action
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
