/** shields-style SVG badge for the lowest score across all workflows. */
export function formatBadge(files) {
  const scores = files.flatMap((f) => (f.results || []).map((r) => r.score));
  const worst = scores.length ? Math.min(...scores) : null;
  const value = worst === null ? 'n/a' : `${worst}/100`;
  const color = worst === null ? '#9f9f9f' : worst >= 90 ? '#3fb950' : worst >= 75 ? '#a3c644' : worst >= 60 ? '#d29922' : '#f85149';
  const label = 'n8n-lint';
  const lw = 58, vw = Math.max(44, value.length * 8 + 14), w = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#24292f"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${label}</text><text x="${lw + vw / 2}" y="14">${value}</text></g></svg>
`;
}
