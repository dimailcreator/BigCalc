export type NavigationIconName = "menu" | "history" | "more" | "back";

const paths: Record<NavigationIconName, string> = {
  menu: "M4 6.5h16M4 12h16M4 17.5h16",
  history: "M4 8.5A8.5 8.5 0 1 1 3.5 15M3.5 4.5v4.5H8M12 7.5V12l3.2 2.2",
  more: "M12 4.5h.01M12 12h.01M12 19.5h.01",
  back: "M19 12H5m6-6-6 6 6 6"
};

export function createNavigationIcon(name: NavigationIconName): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", name === "more" ? "4" : "2.4");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", paths[name]);
  icon.append(path);
  return icon;
}
