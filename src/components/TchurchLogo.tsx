type TchurchLogoSize = "xs" | "sm" | "md" | "lg" | "hero";
type TchurchLogoVariant = "compact" | "stacked" | "mark";

const COMPACT_SIZE: Record<TchurchLogoSize, { mark: string; text: string; gap: string }> = {
  xs: { mark: "h-5 w-auto", text: "text-sm font-bold", gap: "gap-1.5" },
  sm: { mark: "h-6 w-auto", text: "text-base font-bold", gap: "gap-2" },
  md: { mark: "h-8 w-auto", text: "text-xl font-bold", gap: "gap-2.5" },
  lg: { mark: "h-12 w-auto", text: "text-3xl font-extrabold", gap: "gap-3" },
  hero: { mark: "h-16 w-auto", text: "text-5xl font-extrabold", gap: "gap-4" },
};

const STACKED_SIZE: Record<TchurchLogoSize, { mark: string; text: string; gap: string }> = {
  xs: { mark: "h-9 w-auto", text: "text-lg font-extrabold", gap: "gap-2" },
  sm: { mark: "h-12 w-auto", text: "text-2xl font-extrabold", gap: "gap-2" },
  md: { mark: "h-16 w-auto", text: "text-3xl font-extrabold", gap: "gap-2.5" },
  lg: { mark: "h-24 w-auto", text: "text-4xl font-extrabold", gap: "gap-3" },
  hero: { mark: "h-32 w-auto", text: "text-5xl font-extrabold", gap: "gap-4" },
};

const MARK_SIZE: Record<TchurchLogoSize, string> = {
  xs: "h-5 w-auto",
  sm: "h-6 w-auto",
  md: "h-8 w-auto",
  lg: "h-12 w-auto",
  hero: "h-16 w-auto",
};

function TchurchMark({ className = "" }: { className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src="/brand/tchurch-mark.png"
    />
  );
}

function TchurchWord({ className = "", purple = false }: { className?: string; purple?: boolean }) {
  if (purple) {
    return <span className={`text-primary ${className}`}>Tchurch</span>;
  }

  return (
    <span className={className}>
      <span className="text-primary">T</span>
      <span className="text-foreground">church</span>
    </span>
  );
}

export function TchurchLogo({
  size = "md",
  variant = "compact",
  className = "",
  wordPurple = false,
}: {
  size?: TchurchLogoSize;
  variant?: TchurchLogoVariant;
  className?: string;
  wordPurple?: boolean;
}) {
  if (variant === "mark") {
    return (
      <span className={`inline-flex items-center justify-center text-primary ${className}`} aria-label="Tchurch">
        <TchurchMark className={MARK_SIZE[size]} />
      </span>
    );
  }

  if (variant === "stacked") {
    const stacked = STACKED_SIZE[size];

    return (
      <span className={`inline-flex flex-col items-center justify-center ${stacked.gap} ${className}`} aria-label="Tchurch">
        <TchurchMark className={`${stacked.mark} object-contain`} />
        <TchurchWord className={`${stacked.text} leading-none tracking-tight`} purple={wordPurple} />
      </span>
    );
  }

  const compact = COMPACT_SIZE[size];

  return (
    <span className={`inline-flex items-center justify-center leading-none ${compact.gap} ${className}`} aria-label="Tchurch">
      <TchurchMark className={`${compact.mark} shrink-0 object-contain`} />
      <TchurchWord className={`${compact.text} leading-none tracking-tight`} purple={wordPurple} />
    </span>
  );
}
