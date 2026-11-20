import type { KeepAwakeHold } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { CoffeeIcon } from "lucide-react";
import type { MouseEvent } from "react";

import {
  usePrimarySettings,
  usePrimarySettingsAvailable,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../CommandPalette.logic";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A click holds or releases; a right-click holds until no run is active, or releases. */
function nextKeepAwakeHold(now: KeepAwakeHold, button: "left" | "right"): KeepAwakeHold {
  if (now !== "off") return "off";
  return button === "left" ? "on" : "agents";
}

function useKeepAwake() {
  const hold = usePrimarySettings((settings) => settings.keepAwakeHold);
  const available = usePrimarySettingsAvailable();
  const updateSettings = useUpdatePrimarySettings();
  const press = (button: "left" | "right") =>
    updateSettings({ keepAwakeHold: nextKeepAwakeHold(hold, button) });
  return { hold, available, press };
}

export function KeepAwakeCup() {
  const gt = useGT();
  const { hold, available, press } = useKeepAwake();
  if (!available) return null;
  const label =
    hold === "on"
      ? gt("Keeping this computer awake. Click to let it sleep.")
      : hold === "agents"
        ? gt("Keeping this computer awake until agents finish. Click to let it sleep.")
        : gt("Keep this computer awake. Right-click to keep it awake until agents finish.");
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    press("right");
  };
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              aria-pressed={hold !== "off"}
              data-keep-awake={hold}
              onClick={() => press("left")}
              onContextMenu={onContextMenu}
              size="icon"
            >
              <span className={cn("relative inline-flex", hold !== "off" && "text-primary")}>
                <CoffeeIcon />
                {hold === "agents" ? (
                  <span className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export function useKeepAwakeCommandItem(): CommandPaletteActionItem | null {
  const gt = useGT();
  const { hold, available, press } = useKeepAwake();
  if (!available) return null;
  return {
    kind: "action",
    value: "action:keep-awake",
    searchTerms: ["keep awake", "caffeinate", "sleep", "awake", "coffee"],
    title: hold === "off" ? gt("Keep this computer awake") : gt("Let this computer sleep"),
    icon: <CoffeeIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      press("left");
    },
  };
}
