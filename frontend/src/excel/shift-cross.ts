import type { Workbook } from 'xlsx-populate/browser/xlsx-populate-no-encryption.min.js';

export interface CrossPosition {
  row: number;
  column: number;
}

/** Select the site's pictures without moving them; lines use cell anchors without editAs. */
export async function addShiftCrosses(
  workbook: Workbook,
  positions: readonly CrossPosition[],
  site: 1 | 2,
): Promise<void> {
  const path = 'xl/drawings/drawing1.xml';
  const drawing = (await workbook._zip.file(path).async('string')).replace(
    /r:embed="rId[12]"/g,
    `r:embed="rId${site}"`,
  );
  let id = Math.max(
    ...Array.from(drawing.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g), (match) => Number(match[1])),
  );
  const marker = (name: string, row: number, column: number) =>
    `<xdr:${name}><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`;
  const lines = positions
    .flatMap(({ row, column }) =>
      [false, true].map((flip) => {
        id++;
        return (
          `<xdr:twoCellAnchor>${marker('from', row - 1, column - 1)}${marker('to', row + 1, column + 2)}` +
          `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="Line ${id}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
          `<xdr:spPr><a:xfrm${flip ? ' flipV="1"' : ''}><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>` +
          '<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
          '</xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:twoCellAnchor>'
        );
      }),
    )
    .join('');
  workbook._zip.file(path, drawing.replace('</xdr:wsDr>', lines + '</xdr:wsDr>'));
}
