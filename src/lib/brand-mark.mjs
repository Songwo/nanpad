/** 知屿标记：两片互相承接的岛形纸页；同一几何用于界面与安装图标。 */
export const BRAND_MARK = {
  upper:
    "M18 12H43C46.6 12 48.4 16.4 45.8 19L29 36H14C10.4 36 8.6 31.6 11.2 29L27 13.2C27.8 12.4 28.7 12 30 12Z",
  lower:
    "M35 28H50C53.6 28 55.4 32.4 52.8 35L37 50.8C36.2 51.6 35.3 52 34 52H21C17.4 52 15.6 47.6 18.2 45Z",
  plate: "#123D39",
  edge: "#34635B",
  paper: "#F4F3E9",
  jade: "#9EDBBD",
};
export function brandSvg({ plate = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
${plate ? `<rect x="1" y="1" width="62" height="62" rx="16" fill="${BRAND_MARK.plate}"/><rect x="1.5" y="1.5" width="61" height="61" rx="15.5" stroke="${BRAND_MARK.edge}"/>` : ""}
<g transform="translate(6 6) scale(.8125)"><path d="${BRAND_MARK.upper}" fill="${plate ? BRAND_MARK.paper : BRAND_MARK.plate}"/><path d="${BRAND_MARK.lower}" fill="${plate ? BRAND_MARK.jade : "#367B66"}"/></g></svg>`;
}
