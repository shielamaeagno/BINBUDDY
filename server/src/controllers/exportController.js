import { db } from "../db.js";

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getLogsXml(_req, res) {
  const rows = db
    .prepare(
      `
    SELECT wl.log_code, wl.waste_type, wl.weight, wl.status, wl.created_at, wl.completed_at, wl.eco_points_awarded,
           u.user_code AS user_code, u.full_name AS user_name,
           vu.user_code AS verifier_code
    FROM waste_logs wl
    JOIN users u ON u.id = wl.user_id
    LEFT JOIN users vu ON vu.id = wl.verified_by
    ORDER BY wl.created_at DESC
  `
    )
    .all();

  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  // Excel can open this XML; the XSL provides a spreadsheet-like view.
  lines.push(`<?xml-stylesheet type="text/xsl" href="/api/export/logs.xsl"?>`);
  lines.push(`<binbuddy_export generated_at="${xmlEscape(new Date().toISOString())}">`);
  lines.push(`  <waste_logs>`);
  for (const r of rows) {
    lines.push(
      `    <log code="${xmlEscape(r.log_code)}" status="${xmlEscape(r.status)}">` +
        `<user_id>${xmlEscape(r.user_code)}</user_id>` +
        `<user_name>${xmlEscape(r.user_name)}</user_name>` +
        `<waste_type>${xmlEscape(r.waste_type)}</waste_type>` +
        `<weight>${xmlEscape(r.weight)}</weight>` +
        `<points>${xmlEscape(r.eco_points_awarded ?? 0)}</points>` +
        `<created_at>${xmlEscape(r.created_at)}</created_at>` +
        `<completed_at>${xmlEscape(r.completed_at ?? "")}</completed_at>` +
        `<verifier>${xmlEscape(r.verifier_code ?? "")}</verifier>` +
        `</log>`
    );
  }
  lines.push(`  </waste_logs>`);
  lines.push(`</binbuddy_export>`);

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=binbuddy-waste-logs.xml");
  return res.send(lines.join("\n"));
}

export function getLogsXsl(_req, res) {
  const xsl = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
        <title>BinBuddy Waste Logs</title>
        <style>
          body { font-family: Segoe UI, Arial, sans-serif; padding: 16px; }
          h2 { margin: 0 0 10px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #cfe3cf; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #eaf7ea; }
          .muted { color: #4f6b4f; font-size: 12px; margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <h2>BinBuddy · Waste Logs Export</h2>
        <div class="muted">Tip: You can open the downloaded XML in Microsoft Excel to view it like a spreadsheet.</div>
        <table>
          <tr>
            <th>Log Code</th>
            <th>User ID</th>
            <th>User Name</th>
            <th>Type</th>
            <th>Weight</th>
            <th>Status</th>
            <th>Points</th>
            <th>Created At</th>
            <th>Completed At</th>
            <th>Verifier</th>
          </tr>
          <xsl:for-each select="binbuddy_export/waste_logs/log">
            <tr>
              <td><xsl:value-of select="@code"/></td>
              <td><xsl:value-of select="user_id"/></td>
              <td><xsl:value-of select="user_name"/></td>
              <td><xsl:value-of select="waste_type"/></td>
              <td><xsl:value-of select="weight"/></td>
              <td><xsl:value-of select="@status"/></td>
              <td><xsl:value-of select="points"/></td>
              <td><xsl:value-of select="created_at"/></td>
              <td><xsl:value-of select="completed_at"/></td>
              <td><xsl:value-of select="verifier"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=binbuddy-waste-logs.xsl");
  return res.send(xsl);
}

