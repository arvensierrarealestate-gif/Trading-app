"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type MouseEventParams,
  type CandlestickData,
} from "lightweight-charts";

export type ChartCandle = { date: string; open: number; high: number; low: number; close: number; volume: number };
export type ChartLevel = { price: number; label: string; color: string; dashed?: boolean };

// TradingView Lightweight Charts wrapper. Renders candlesticks + horizontal
// level lines (S/R, targets, stop, round numbers) with a live crosshair
// readout. Distance labels are baked into each level's title by the caller.
export default function TVChart({
  candles,
  levels,
  height = 340,
}: {
  candles: ChartCandle[];
  levels: ChartLevel[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [readout, setReadout] = useState<string>("");

  // Create the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      height,
      autoSize: true,
      layout: { background: { color: "#0a0c12" }, textColor: "#9aa4b8", fontSize: 11 },
      grid: { vertLines: { color: "#141a24" }, horzLines: { color: "#141a24" } },
      rightPriceScale: { borderColor: "#2a3550" },
      timeScale: { borderColor: "#2a3550" },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3fdc8a",
      downColor: "#ff7070",
      borderVisible: false,
      wickUpColor: "#3fdc8a",
      wickDownColor: "#ff7070",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const onMove = (param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setReadout("");
        return;
      }
      const d = param.seriesData.get(series) as CandlestickData | undefined;
      if (d && typeof d.close === "number") {
        const chg = ((d.close - d.open) / d.open) * 100;
        setReadout(
          `${String(param.time)}  ·  O ${d.open.toFixed(2)}  H ${d.high.toFixed(2)}  L ${d.low.toFixed(2)}  C ${d.close.toFixed(2)}  (${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%)`,
        );
      }
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [height]);

  // Push candle data.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      candles.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })),
    );
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Draw / redraw level lines.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    priceLinesRef.current.forEach((pl) => series.removePriceLine(pl));
    priceLinesRef.current = levels.map((lv) =>
      series.createPriceLine({
        price: lv.price,
        color: lv.color,
        lineWidth: 1,
        lineStyle: lv.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: lv.label,
      }),
    );
  }, [levels, candles]);

  return (
    <div>
      <div style={{ fontSize: 11, color: "#7d8699", fontFamily: "monospace", minHeight: 16, marginBottom: 4 }}>
        {readout || " "}
      </div>
      <div ref={containerRef} style={{ width: "100%", height, borderRadius: 6, overflow: "hidden" }} />
    </div>
  );
}
