import React, { useState, useRef, lazy, Suspense } from 'react';

const Beam3DScene = lazy(() => import('./Beam3DScene'));
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Download } from 'lucide-react';
import type { FlexureResult, ShearResult } from '@/lib/structuralEngine';

interface BeamRebarDetailViewProps {
  beamId: string;
  b: number; // mm
  h: number; // mm
  span: number; // m
  flexLeft: FlexureResult;
  flexMid: FlexureResult;
  flexRight: FlexureResult;
  shear: ShearResult;
  cover?: number;
  bentUpAngle?: number;
  hasBentBars?: boolean;
  additionalTopLeft?: number;
  additionalTopRight?: number;
}

export default function BeamRebarDetailView({
  beamId, b, h, span, flexLeft, flexMid, flexRight, shear,
  cover = 40, bentUpAngle = 45, hasBentBars = false,
  additionalTopLeft = 0, additionalTopRight = 0,
}: BeamRebarDetailViewProps) {
  const [activeView, setActiveView] = useState('longitudinal');
  const svgRef = useRef<SVGSVGElement>(null);

  const svgWidth = 800;
  const svgHeight = 400;
  const margin = 60;
  const beamDrawW = svgWidth - 2 * margin;
  const beamDrawH = 120;
  const beamY = (svgHeight - beamDrawH) / 2;

  const scaleH = beamDrawH / h;
  const topCoverPx = cover * scaleH;
  const botCoverPx = cover * scaleH;

  const topY = beamY + topCoverPx + 10;
  const botY = beamY + beamDrawH - botCoverPx - 10;
  const bentZoneLen = beamDrawW / 4;

  const topLeftBars = additionalTopLeft > 0 ? Math.max(additionalTopLeft, flexLeft.bars) : flexLeft.bars;
  const topRightBars = additionalTopRight > 0 ? Math.max(additionalTopRight, flexRight.bars) : flexRight.bars;

  // Bottom bars: minimum 4, with 2 continuous + 2 bent-up
  const botBars = flexMid.bars;
  const continuousBot = hasBentBars ? Math.max(2, botBars - 2) : botBars;
  const bentBars = hasBentBars ? Math.min(2, botBars - continuousBot) : 0;

  const csWidth = 150;
  const csHeight = Math.min(csWidth * (h / b), 250);

  const exportPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF('landscape', 'mm', 'a4');
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`Beam ${beamId} - Reinforcement Details`, pw / 2, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`${b}x${h}mm, L=${(span * 1000).toFixed(0)}mm`, pw / 2, 22, { align: 'center' });

      // Draw longitudinal section
      const ox = 20, oy = 35;
      const dw = pw - 40, dh = 60;
      doc.setDrawColor(0);
      doc.setLineWidth(0.5);
      doc.rect(ox, oy, dw, dh);

      // Support triangles (using lines instead of triangle method)
      doc.line(ox, oy + dh, ox - 3, oy + dh + 5);
      doc.line(ox - 3, oy + dh + 5, ox + 3, oy + dh + 5);
      doc.line(ox + 3, oy + dh + 5, ox, oy + dh);
      doc.line(ox + dw, oy + dh, ox + dw - 3, oy + dh + 5);
      doc.line(ox + dw - 3, oy + dh + 5, ox + dw + 3, oy + dh + 5);
      doc.line(ox + dw + 3, oy + dh + 5, ox + dw, oy + dh);

      // Top bars
      const tY = oy + 8;
      doc.setDrawColor(220, 50, 50);
      doc.setLineWidth(0.8);
      for (let i = 0; i < Math.max(topLeftBars, topRightBars); i++) {
        doc.line(ox + 3, tY + i * 2.5, ox + dw - 3, tY + i * 2.5);
      }

      // Bottom continuous bars
      const bY = oy + dh - 8;
      doc.setDrawColor(50, 100, 220);
      for (let i = 0; i < continuousBot; i++) {
        doc.line(ox + 3, bY - i * 2.5, ox + dw - 3, bY - i * 2.5);
      }

      // Bent-up bars per ACI 318: Top(left) → diag down → Bot(mid) → diag up → Top(right)
      if (hasBentBars && bentBars > 0) {
        doc.setDrawColor(240, 160, 30);
        doc.setLineWidth(0.6);
        for (let i = 0; i < bentBars; i++) {
          const yBot = bY - (continuousBot + i) * 2.5;
          const yTop = tY + 3;
          const hDiff = Math.abs(yBot - yTop);
          const diagRunPdf = hDiff * 1.0;
          const bendDownStartX = ox + dw * 0.20;
          const bendDownEndX = bendDownStartX + diagRunPdf;
          const bendUpEndX = ox + dw * 0.80;
          const bendUpStartX = bendUpEndX - diagRunPdf;
          doc.line(ox + 3, yTop, bendDownStartX, yTop);
          doc.line(bendDownStartX, yTop, bendDownEndX, yBot);
          doc.line(bendDownEndX, yBot, bendUpStartX, yBot);
          doc.line(bendUpStartX, yBot, bendUpEndX, yTop);
          doc.line(bendUpEndX, yTop, ox + dw - 3, yTop);
        }
      }

      // Stirrups
      doc.setDrawColor(30, 180, 100);
      doc.setLineWidth(0.3);
      const numSt = Math.min(Math.floor((span * 1000) / shear.sUsed), 40);
      const stStep = dw / numSt;
      for (let i = 1; i < numSt; i++) {
        const x = ox + i * stStep;
        doc.rect(x - 0.3, oy + 2, 0.6, dh - 4);
      }

      // Dimension
      doc.setDrawColor(100);
      doc.setFontSize(9);
      doc.setTextColor(0);
      doc.text(`L = ${(span * 1000).toFixed(0)} mm`, ox + dw / 2, oy + dh + 14, { align: 'center' });
      doc.setFontSize(8);
      doc.text(`h = ${h}mm`, ox - 10, oy + dh / 2);

      // Labels
      doc.setFontSize(9);
      doc.setTextColor(220, 50, 50);
      doc.text(`Top: ${topLeftBars}\u03A6${flexLeft.dia}`, ox + 10, oy - 2);
      doc.text(`Top: ${topRightBars}\u03A6${flexRight.dia}`, ox + dw - 35, oy - 2);
      doc.setTextColor(50, 100, 220);
      doc.text(`Bot: ${botBars}\u03A6${flexMid.dia}${hasBentBars ? ` (${continuousBot} cont + ${bentBars} bent)` : ''}`, ox + dw / 2, oy + dh + 22, { align: 'center' });
      doc.setTextColor(30, 180, 100);
      doc.text(`Stirrups: ${shear.stirrups}`, ox + dw / 2, oy - 2, { align: 'center' });

      // Cross sections
      doc.setTextColor(0);
      doc.setFontSize(10);
      doc.text('Cross Sections', pw / 2, oy + dh + 35, { align: 'center' });

      const sections = [
        { label: 'Left Support', topB: topLeftBars, topD: flexLeft.dia, botB: botBars, botD: flexMid.dia, cx: pw / 4 },
        { label: 'Mid-Span', topB: 2, topD: flexLeft.dia, botB: continuousBot, botD: flexMid.dia, cx: pw / 2 },
        { label: 'Right Support', topB: topRightBars, topD: flexRight.dia, botB: botBars, botD: flexMid.dia, cx: 3 * pw / 4 },
      ];

      const csW = 30, csH = 45;
      const csOy = oy + dh + 42;
      sections.forEach(sec => {
        doc.setDrawColor(0);
        doc.setLineWidth(0.5);
        doc.rect(sec.cx - csW / 2, csOy, csW, csH);
        doc.setDrawColor(30, 180, 100);
        doc.setLineWidth(0.3);
        doc.rect(sec.cx - csW / 2 + 2, csOy + 2, csW - 4, csH - 4);
        // Top bars (draw filled circles manually since jsPDF has no circle method)
        doc.setFillColor(220, 50, 50);
        for (let i = 0; i < sec.topB; i++) {
          const bx = sec.cx - csW / 2 + 4 + i * ((csW - 8) / (sec.topB - 1 || 1));
          doc.setDrawColor(220, 50, 50);
          doc.ellipse(bx, csOy + 5, 1.2, 1.2, 'F');
        }
        // Bottom bars
        doc.setFillColor(50, 100, 220);
        for (let i = 0; i < sec.botB; i++) {
          const bx = sec.cx - csW / 2 + 4 + i * ((csW - 8) / (sec.botB - 1 || 1));
          doc.setDrawColor(50, 100, 220);
          doc.ellipse(bx, csOy + csH - 5, 1.2, 1.2, 'F');
        }
        doc.setTextColor(0);
        doc.setFontSize(7);
        doc.text(sec.label, sec.cx, csOy + csH + 5, { align: 'center' });
        doc.text(`T:${sec.topB}\u03A6${sec.topD} B:${sec.botB}\u03A6${sec.botD}`, sec.cx, csOy + csH + 9, { align: 'center' });
      });

      doc.save(`Beam_${beamId}_Details.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">تفاصيل تسليح الجسر {beamId} ({b}×{h}mm, L={span.toFixed(2)}m)</CardTitle>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={exportPDF}>
          <Download size={12} />PDF
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={activeView} onValueChange={setActiveView}>
          <TabsList className="mb-2">
            <TabsTrigger value="longitudinal" className="text-xs">مقطع طولي</TabsTrigger>
            <TabsTrigger value="cross" className="text-xs">مقطع عرضي</TabsTrigger>
            <TabsTrigger value="3d" className="text-xs">منظور 3D</TabsTrigger>
          </TabsList>

          {/* LONGITUDINAL SECTION */}
          <TabsContent value="longitudinal">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full border border-border rounded bg-card">
              <rect x={margin} y={beamY} width={beamDrawW} height={beamDrawH}
                fill="hsl(var(--muted))" stroke="hsl(var(--foreground))" strokeWidth="2" />

              {/* Support triangles */}
              <polygon points={`${margin},${beamY + beamDrawH} ${margin - 15},${beamY + beamDrawH + 20} ${margin + 15},${beamY + beamDrawH + 20}`}
                fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
              <polygon points={`${margin + beamDrawW},${beamY + beamDrawH} ${margin + beamDrawW - 15},${beamY + beamDrawH + 20} ${margin + beamDrawW + 15},${beamY + beamDrawH + 20}`}
                fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.5" />

              {/* Top reinforcement (continuous) */}
              {Array.from({ length: Math.max(topLeftBars, topRightBars) }, (_, i) => (
                <line key={`top-${i}`} x1={margin + 10} y1={topY + i * 6} x2={margin + beamDrawW - 10} y2={topY + i * 6}
                  stroke="#ef4444" strokeWidth="3" />
              ))}

              {/* Bottom continuous bars */}
              {Array.from({ length: continuousBot }, (_, i) => (
                <line key={`bot-${i}`} x1={margin + 10} y1={botY - i * 6} x2={margin + beamDrawW - 10} y2={botY - i * 6}
                  stroke="#3b82f6" strokeWidth="3" />
              ))}

              {/* Bent-up bars per ACI 318: Top(left support) → diagonal down → Bottom(mid-span) → diagonal up → Top(right support) */}
              {hasBentBars && Array.from({ length: bentBars }, (_, i) => {
                const yBot = botY - (continuousBot + i) * 6;
                const yTop = topY + 5;
                const heightDiff = Math.abs(yBot - yTop);
                const diagRun = heightDiff;
                const bendDownStartX = margin + beamDrawW * 0.20;
                const bendDownEndX = bendDownStartX + diagRun;
                const bendUpEndX = margin + beamDrawW * 0.80;
                const bendUpStartX = bendUpEndX - diagRun;
                return (
                  <g key={`bent-${i}`}>
                    <polyline
                      points={`${margin + 10},${yTop} ${bendDownStartX},${yTop} ${bendDownEndX},${yBot} ${bendUpStartX},${yBot} ${bendUpEndX},${yTop} ${margin + beamDrawW - 10},${yTop}`}
                      fill="none" stroke="#f59e0b" strokeWidth="2.5" />
                    <text x={bendDownStartX + diagRun / 2 + 5} y={(yBot + yTop) / 2 - 3} className="fill-foreground" fontSize="9" fontFamily="JetBrains Mono">{bentUpAngle}°</text>
                    <text x={bendUpStartX + diagRun / 2 - 15} y={(yBot + yTop) / 2 - 3} className="fill-foreground" fontSize="9" fontFamily="JetBrains Mono">{bentUpAngle}°</text>
                  </g>
                );
              })}

              {/* Stirrups */}
              {Array.from({ length: Math.floor(beamDrawW / (shear.sUsed * beamDrawW / (span * 1000))) }, (_, i) => {
                const x = margin + (i + 1) * (shear.sUsed * beamDrawW / (span * 1000));
                if (x > margin + beamDrawW - 5) return null;
                return <rect key={`st-${i}`} x={x - 1} y={beamY + 4} width={2} height={beamDrawH - 8}
                  fill="none" stroke="#10b981" strokeWidth="1" rx="1" />;
              })}

              {/* Dimension lines */}
              <line x1={margin} y1={beamY + beamDrawH + 35} x2={margin + beamDrawW} y2={beamY + beamDrawH + 35}
                stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" markerStart="url(#arrow)" markerEnd="url(#arrow)" />
              <text x={margin + beamDrawW / 2} y={beamY + beamDrawH + 50}
                textAnchor="middle" className="fill-muted-foreground" fontSize="11" fontFamily="JetBrains Mono">
                L = {(span * 1000).toFixed(0)} mm
              </text>
              <line x1={margin - 25} y1={beamY} x2={margin - 25} y2={beamY + beamDrawH}
                stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" />
              <text x={margin - 30} y={beamY + beamDrawH / 2}
                textAnchor="end" className="fill-muted-foreground" fontSize="10" fontFamily="JetBrains Mono"
                transform={`rotate(-90,${margin - 30},${beamY + beamDrawH / 2})`}>
                h = {h}mm
              </text>

              {/* Labels */}
              <text x={margin + 20} y={topY - 8} className="fill-foreground" fontSize="10" fontFamily="JetBrains Mono">
                علوي: {topLeftBars}Φ{flexLeft.dia}
              </text>
              <text x={margin + beamDrawW - 20} y={topY - 8} textAnchor="end" className="fill-foreground" fontSize="10" fontFamily="JetBrains Mono">
                علوي: {topRightBars}Φ{flexRight.dia}
              </text>
              <text x={margin + beamDrawW / 2} y={botY + 18} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="JetBrains Mono">
                سفلي: {continuousBot}Φ{flexMid.dia} مستمر{hasBentBars ? ` + ${bentBars}Φ${flexMid.dia} مكسح` : ''}
              </text>
              <text x={margin + beamDrawW / 2} y={beamY - 8} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="JetBrains Mono">
                كانات: {shear.stirrups}
              </text>

              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5"
                  markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--muted-foreground))" />
                </marker>
              </defs>
            </svg>
          </TabsContent>

          {/* CROSS SECTION */}
          <TabsContent value="cross">
            <svg viewBox={`0 0 ${svgWidth} 400`} className="w-full border border-border rounded bg-card">
              {[
                { label: 'مقطع يسار', x: 80, topBars: topLeftBars, topDia: flexLeft.dia, botBars: botBars, botDia: flexMid.dia },
                { label: 'مقطع وسط', x: 330, topBars: 2, topDia: flexLeft.dia, botBars: continuousBot, botDia: flexMid.dia },
                { label: 'مقطع يمين', x: 580, topBars: topRightBars, topDia: flexRight.dia, botBars: botBars, botDia: flexMid.dia },
              ].map((sec, idx) => {
                const w = csWidth;
                const hh = csHeight;
                const sx = sec.x - w / 2;
                const sy = 60;
                const coverPx = cover * (hh / h);
                const stirrupInset = 8;
                return (
                  <g key={idx}>
                    <rect x={sx} y={sy} width={w} height={hh} fill="hsl(var(--muted))" stroke="hsl(var(--foreground))" strokeWidth="2" />
                    <rect x={sx + stirrupInset} y={sy + stirrupInset} width={w - 2 * stirrupInset} height={hh - 2 * stirrupInset}
                      fill="none" stroke="#10b981" strokeWidth="1.5" rx="3" />
                    {Array.from({ length: sec.topBars }, (_, i) => {
                      const barSpacing = (w - 2 * coverPx - 2 * stirrupInset) / (sec.topBars - 1 || 1);
                      const bx = sx + coverPx + stirrupInset + i * barSpacing;
                      const by = sy + coverPx + stirrupInset;
                      const r = Math.min(sec.topDia * (w / b) / 2, 6);
                      return <circle key={`t${i}`} cx={bx} cy={by} r={r} fill="#ef4444" />;
                    })}
                    {Array.from({ length: sec.botBars }, (_, i) => {
                      const barSpacing = (w - 2 * coverPx - 2 * stirrupInset) / (sec.botBars - 1 || 1);
                      const bx = sx + coverPx + stirrupInset + i * barSpacing;
                      const by = sy + hh - coverPx - stirrupInset;
                      const r = Math.min(sec.botDia * (w / b) / 2, 6);
                      return <circle key={`b${i}`} cx={bx} cy={by} r={r} fill="#3b82f6" />;
                    })}
                    <text x={sec.x} y={sy + hh + 20} textAnchor="middle" className="fill-foreground" fontSize="11" fontFamily="JetBrains Mono">{sec.label}</text>
                    <text x={sec.x} y={sy + hh + 35} textAnchor="middle" className="fill-muted-foreground" fontSize="9" fontFamily="JetBrains Mono">
                      علوي:{sec.topBars}Φ{sec.topDia} | سفلي:{sec.botBars}Φ{sec.botDia}
                    </text>
                    <text x={sec.x} y={sy - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="10" fontFamily="JetBrains Mono">{b}×{h}</text>
                  </g>
                );
              })}
            </svg>
          </TabsContent>

          {/* 3D Interactive View with rotation/zoom */}
          <TabsContent value="3d">
            <Suspense fallback={<div className="flex items-center justify-center h-[450px] text-muted-foreground">جاري تحميل العرض ثلاثي الأبعاد...</div>}>
              <Beam3DScene
                b={b} h={h} span={span}
                topBarsLeft={topLeftBars} topBarsRight={topRightBars}
                topDia={flexLeft.dia}
                botBarsTotal={botBars}
                continuousBot={continuousBot}
                bentBars={bentBars}
                botDia={flexMid.dia}
                stirrupSpacing={shear.sUsed}
                stirrupDia={10}
                cover={cover}
                hasBentBars={hasBentBars}
                bentUpAngle={bentUpAngle}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}