import { chordProToDisplayLines } from "@/lib/songDisplay";

type GenerateChordChartPdfParams = {
  title: string;
  artist?: string | null;
  key?: string | null;
  chordPro: string;
};

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "chord-chart";
}

export async function generateChordChartPdf({
  title,
  artist,
  key,
  chordPro,
}: GenerateChordChartPdfParams) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  const accent = "#6d3fd9";
  const ink = "#111827";
  const muted = "#64748b";
  const soft = "#f5f3ff";
  let y = 46;

  function addPageIfNeeded(extra = 32) {
    if (y + extra < pageHeight - margin) return;
    doc.addPage();
    y = margin;
  }

  doc.setFillColor(accent);
  doc.roundedRect(margin, 32, 54, 7, 3, 3, "F");

  doc.setTextColor(ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text(title || "Chord Chart", margin, y + 38, { maxWidth: contentWidth });

  y += 70;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(muted);
  const meta = [artist, key ? `Key ${key}` : null, "Tchurch worship chart"].filter(Boolean).join("  /  ");
  doc.text(meta, margin, y, { maxWidth: contentWidth });

  y += 24;
  doc.setDrawColor("#e5e7eb");
  doc.line(margin, y, pageWidth - margin, y);
  y += 28;

  const lines = chordProToDisplayLines(chordPro, 1000);
  doc.setFont("courier", "normal");

  for (const line of lines) {
    if (line.kind === "blank") {
      y += 12;
      continue;
    }

    if (line.kind === "section") {
      addPageIfNeeded(30);
      const label = line.label.toUpperCase();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(accent);
      const width = doc.getTextWidth(label) + 22;
      doc.setFillColor(soft);
      doc.roundedRect(margin, y - 14, width, 22, 11, 11, "F");
      doc.text(label, margin + 11, y + 1);
      y += 30;
      doc.setFont("courier", "normal");
      continue;
    }

    if (line.kind === "meta") {
      continue;
    }

    const chordRows = line.chords ? doc.splitTextToSize(line.chords, contentWidth) : [];
    const lyricRows = line.lyrics ? doc.splitTextToSize(line.lyrics, contentWidth) : [];
    const rowHeight = 15;
    const needed = (chordRows.length + lyricRows.length) * rowHeight + 8;
    addPageIfNeeded(needed);

    if (line.chords) {
      doc.setFont("courier", "bold");
      doc.setFontSize(12);
      doc.setTextColor(accent);
      for (const row of chordRows) {
        doc.text(row, margin, y);
        y += rowHeight;
      }
    }

    if (line.lyrics) {
      doc.setFont("courier", "normal");
      doc.setFontSize(12);
      doc.setTextColor(ink);
      for (const row of lyricRows) {
        doc.text(row, margin, y);
        y += rowHeight;
      }
    }

    y += 5;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#94a3b8");
    doc.text(`Tchurch / ${title}`, margin, pageHeight - 24);
    doc.text(`${page}/${pageCount}`, pageWidth - margin - 18, pageHeight - 24);
  }

  doc.save(`${sanitizeFileName(title)}${key ? `-${sanitizeFileName(key)}` : ""}.pdf`);
}
