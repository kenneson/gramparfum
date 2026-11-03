"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { TZ, dataHora, hojeISO } from "@/lib/domain";
import { Button } from "@/components/ui";

// texto | inteiro | diferença com sinal (+2/-1) | data ISO (exibida no fuso de São Paulo)
// | campo: caixa em branco para preencher à mão (ex.: contagem impressa)
export type Coluna = { titulo: string; tipo?: "texto" | "int" | "dif" | "data" | "campo"; largura?: number };
export type Celula = string | number | null;
type Tabela = {
  arquivo: string;
  titulo: string;
  subtitulo?: string;
  colunas: Coluna[];
  linhas: Celula[][];
  paisagem?: boolean;
};

const INK = "FF16130F";
const GOLD = "FFF2DF57";
const PAPER = "FFF6F3EC";
const LINE = "FFE7E1D4";

const numerica = (c: Coluna) => c.tipo === "int" || c.tipo === "dif";
const nomeArquivo = (t: Tabela, ext: string) => `${t.arquivo}-${hojeISO()}.${ext}`;
const rodapeGerado = () => `Gerado em ${dataHora(new Date().toISOString())}`;

// Excel não tem fuso: grava a hora "de parede" de São Paulo
function dataExcel(iso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, Number(x.value)]),
  );
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

async function excel(t: Tabela) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const n = t.colunas.length;
  // nome da aba: até 31 caracteres, sem a loja ("Inventário — Loja X" → "Inventário")
  const ws = wb.addWorksheet(
    t.titulo
      .split(" — ")[0]
      .replace(/[[\]:*?/\\]/g, "")
      .slice(0, 31),
    {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: {
        paperSize: 9,
        orientation: t.paisagem ? "landscape" : "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );
  ws.columns = t.colunas.map((c) => ({ width: c.largura ?? (numerica(c) ? 11 : c.tipo === "data" ? 17 : 18) }));

  ws.mergeCells(1, 1, 1, n);
  Object.assign(ws.getCell(1, 1), { value: t.titulo, font: { bold: true, size: 15, color: { argb: INK } } });
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, n);
  Object.assign(ws.getCell(2, 1), {
    value: [t.subtitulo, rodapeGerado()].filter(Boolean).join(" · "),
    font: { size: 9, color: { argb: "FF6E6658" } },
  });

  const head = ws.getRow(4);
  head.values = t.colunas.map((c) => c.titulo);
  head.height = 20;
  head.eachCell((cell, i) => {
    cell.font = { bold: true, color: { argb: GOLD } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: numerica(t.colunas[i - 1]) ? "right" : "left" };
  });

  t.linhas.forEach((linha, r) => {
    const row = ws.getRow(5 + r);
    row.values = linha.map((v, i) => (t.colunas[i].tipo === "data" && typeof v === "string" ? dataExcel(v) : v));
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      const c = t.colunas[i - 1];
      if (!c) return;
      cell.numFmt =
        c.tipo === "data"
          ? "dd/mm/yyyy hh:mm"
          : c.tipo === "dif"
            ? "+0;-0;0"
            : c.tipo === "int"
              ? "0"
              : c.tipo === "campo"
                ? "General"
                : "@";
      cell.alignment = { vertical: "top", wrapText: c.tipo === "texto" || !c.tipo };
      if (c.tipo === "campo") {
        const borda = { style: "thin" as const, color: { argb: "FF6E6658" } };
        cell.border = { top: borda, left: borda, bottom: borda, right: borda };
        return;
      }
      cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
      if (r % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PAPER } };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };

  const blob = new Blob([await wb.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: nomeArquivo(t, "xlsx"),
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// Fonte padrão do PDF (WinAnsi) não tem − nem →
const pdfTexto = (s: string) => s.replace(/−/g, "-").replace(/→/g, "->");

async function pdf(t: Tabela) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: t.paisagem ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(22, 19, 15).text(pdfTexto(t.titulo), 14, 16);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110, 102, 88);
  doc.text(pdfTexto([t.subtitulo, rodapeGerado()].filter(Boolean).join(" · ")), 14, 22);

  autoTable(doc, {
    startY: 27,
    margin: { left: 14, right: 14, bottom: 16 },
    head: [t.colunas.map((c) => c.titulo)],
    body: t.linhas.map((l) =>
      l.map((v, i) => {
        const c = t.colunas[i];
        if (c.tipo === "data") return v ? dataHora(String(v)).replace(",", "") : "—";
        if (v === null || v === "") return "";
        if (c.tipo === "dif") return Number(v) > 0 ? `+${v}` : String(v);
        return pdfTexto(String(v));
      }),
    ),
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 },
      textColor: [22, 19, 15],
    },
    headStyles: { fillColor: [22, 19, 15], textColor: [242, 223, 87], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 243, 236] },
    bodyStyles: { lineColor: [231, 225, 212], lineWidth: { bottom: 0.2 } },
    columnStyles: Object.fromEntries(
      t.colunas.map((c, i) => [
        i,
        numerica(c)
          ? { halign: "right" }
          : c.tipo === "data"
            ? { cellWidth: 30 }
            : c.tipo === "campo"
              ? { cellWidth: 24 }
              : {},
      ]),
    ),
    // título das colunas numéricas alinhado com os números
    didParseCell: ({ section, column, cell }) => {
      if (section === "head" && numerica(t.colunas[column.index])) cell.styles.halign = "right";
    },
    didDrawCell: ({ section, column, cell }) => {
      if (section !== "body" || t.colunas[column.index].tipo !== "campo") return;
      doc.setDrawColor(110, 102, 88).setLineWidth(0.25);
      doc.rect(cell.x + 2, cell.y + 1.2, cell.width - 4, cell.height - 2.4);
    },
  });

  const paginas = doc.getNumberOfPages();
  for (let p = 1; p <= paginas; p++) {
    doc.setPage(p).setFontSize(8).setTextColor(110, 102, 88);
    doc.text("GamParfum", 14, alt - 8);
    doc.text(`Página ${p} de ${paginas}`, larg - 14, alt - 8, { align: "right" });
  }
  doc.save(nomeArquivo(t, "pdf"));
}

export function Exportar(t: Tabela) {
  const [ocupado, setOcupado] = useState<"pdf" | "xlsx" | null>(null);
  const rodar = async (tipo: "pdf" | "xlsx") => {
    setOcupado(tipo);
    try {
      await (tipo === "pdf" ? pdf(t) : excel(t));
    } catch (e) {
      toast.error("Não foi possível exportar", { description: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  };
  const vazio = t.linhas.length === 0;
  return (
    <div className="flex shrink-0 gap-2">
      <Button variant="outline" disabled={!!ocupado || vazio} onClick={() => rodar("pdf")}>
        {ocupado === "pdf" ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <FileText size={16} className="text-danger" />
        )}
        PDF
      </Button>
      <Button variant="outline" disabled={!!ocupado || vazio} onClick={() => rodar("xlsx")}>
        {ocupado === "xlsx" ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <FileSpreadsheet size={16} className="text-ok" />
        )}
        Excel
      </Button>
    </div>
  );
}
