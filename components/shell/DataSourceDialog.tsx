"use client";
import { useRef, useState } from "react";
import { Upload, Download, CheckCircle, AlertCircle, X } from "lucide-react";
import { parseCSV, detectAnomalies } from "@/lib/ingest";
import { useBus } from "@/lib/directive-bus";
import { cn } from "@/lib/utils";

type Status = "idle" | "parsing" | "done" | "error";

export function DataSourceDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState("");
  const [drag, setDrag] = useState(false);
  const setExternalData = useBus((s) => s.setExternalData);

  function process(file: File) {
    if (!file.name.endsWith(".csv")) {
      setStatus("error");
      setInfo("Please upload a .csv file.");
      return;
    }
    setStatus("parsing");
    setInfo("Parsing CSV…");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const { buildings, readings } = parseCSV(text);
        setInfo(`Found ${buildings.length} buildings, ${readings.length} readings. Running anomaly detection…`);
        const anomalies = detectAnomalies(buildings, readings);
        setExternalData(buildings, anomalies);
        setStatus("done");
        setInfo(
          `Loaded ${buildings.length} buildings · ${anomalies.length} anomaly${anomalies.length !== 1 ? "ies" : ""} detected. Check the map.`
        );
      } catch (err) {
        setStatus("error");
        setInfo(err instanceof Error ? err.message : "Parse failed.");
      }
    };
    reader.readAsText(file);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) process(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) process(f);
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg-elev-1 border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-fg">Add University Data</h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Upload a CSV to analyze any campus energy data
            </p>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* CSV Format */}
          <div className="rounded-md bg-bg border border-border p-3">
            <p className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">Required CSV columns</p>
            <code className="text-[11px] text-fg-muted leading-relaxed block">
              building_id, building_name, latitude, longitude,<br />
              gross_area_sqft, utility, reading_time, reading_value
            </code>
            <p className="text-[10px] text-fg-subtle mt-2">
              <strong className="text-fg-muted">reading_time</strong>: ISO 8601 e.g. 2025-09-01T08:00:00 &nbsp;·&nbsp;
              <strong className="text-fg-muted">utility</strong>: electricity, natural_gas, chilled_water…
            </p>
          </div>

          {/* Download sample */}
          <a
            href="/samples/princeton_sample.csv"
            download="princeton_sample.csv"
            className="flex items-center gap-2 text-xs text-accent hover:underline w-fit"
          >
            <Download size={13} />
            Download Princeton sample CSV
          </a>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors",
              drag
                ? "border-accent bg-accent-soft"
                : "border-border hover:border-border-strong hover:bg-bg"
            )}
          >
            <Upload size={20} className="text-fg-muted" />
            <p className="text-sm text-fg-muted">Drop CSV here or <span className="text-accent underline">browse</span></p>
            <p className="text-[10px] text-fg-subtle">Any university with the required columns</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFile} />
          </div>

          {/* Status */}
          {status !== "idle" && (
            <div className={cn(
              "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
              status === "done" ? "bg-ok/10 text-ok border border-ok/20" :
              status === "error" ? "bg-danger/10 text-danger border border-danger/20" :
              "bg-bg-elev-2 text-fg-muted border border-border"
            )}>
              {status === "done" ? <CheckCircle size={13} className="shrink-0 mt-0.5" /> :
               status === "error" ? <AlertCircle size={13} className="shrink-0 mt-0.5" /> :
               <div className="w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin shrink-0 mt-0.5" />}
              <span>{info}</span>
            </div>
          )}
        </div>

        <div className="px-5 pb-4 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-border text-fg-muted hover:text-fg transition-colors">
            {status === "done" ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
