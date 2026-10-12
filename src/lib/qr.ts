import qrcode from 'qrcode-generator';

export interface QrMatrix {
  size: number;
  isDark: (row: number, col: number) => boolean;
}

/** QR matrix for a label code. Level M survives a scuffed sticker. */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

/** SVG path data ("M x y h1 v1 h-1 z" per dark module) for rendering in React. */
export function qrPath(text: string): { size: number; d: string } {
  const m = qrMatrix(text);
  let d = '';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { size: m.size, d };
}
