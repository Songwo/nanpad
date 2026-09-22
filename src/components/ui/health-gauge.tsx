import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CountUp } from "./time-ago";

interface HealthGaugeProps {
  score: number;
  size?: number;
  className?: string;
}

export function HealthGauge({ score, size = 136, className }: HealthGaugeProps) {
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  // 仪表盘几何计算
  const strokeWidth = 8;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  // 采用 260 度的圆弧（开口在正下方）
  const arcDegree = 260;
  const arcLength = (arcDegree / 360) * circumference;
  const strokeDashoffset = arcLength - (clampedScore / 100) * arcLength;

  const { tone, label, glowColor, strokeColor } = useMemo(() => {
    if (clampedScore >= 85) {
      return {
        tone: "ok",
        label: t("高安全度"),
        glowColor: "rgba(0, 186, 124, 0.35)",
        strokeColor: "var(--color-ok)",
      };
    }
    if (clampedScore >= 65) {
      return {
        tone: "warn",
        label: t("需要排查"),
        glowColor: "rgba(255, 173, 31, 0.35)",
        strokeColor: "var(--color-warn)",
      };
    }
    return {
      tone: "crit",
      label: t("高危预警"),
      glowColor: "rgba(244, 33, 46, 0.35)",
      strokeColor: "var(--color-crit)",
    };
  }, [clampedScore]);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center select-none",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="rotate-[140deg] overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.4" />
            <stop offset="60%" stopColor={strokeColor} stopOpacity="0.9" />
            <stop offset="100%" stopColor={strokeColor} />
          </linearGradient>
          <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* 轨道底圈 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeOpacity={0.4}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />

        {/* 动态进度发光圆弧 */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#gaugeGradient)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          filter="url(#gaugeGlow)"
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>

      {/* 中心数据显示与状态徽标 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="flex items-baseline justify-center font-bold tracking-tight text-ink">
          <span className="text-3xl tabular-nums leading-none">
            <CountUp value={clampedScore} />
          </span>
          <span className="ml-0.5 text-xs text-muted font-medium">/100</span>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: strokeColor, boxShadow: `0 0 6px ${glowColor}` }}
          />
          <span className="text-[11px] font-medium text-muted">{label}</span>
        </div>
      </div>
    </div>
  );
}
