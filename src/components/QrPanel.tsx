import { useEffect, useState } from "react";

type Props = {
  url: string;
  size?: number;
  label?: string;
  className?: string;
};

/** Renders a QR code for a join URL. Generated in the browser only. */
export function QrPanel({ url, size = 180, label, className }: Props) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(async (mod) => {
      const QRCode = mod.default ?? mod;
      const dataUrl = await QRCode.toDataURL(url, {
        width: size * 2,
        margin: 1,
        color: { dark: "#0b1020", light: "#ffffff" },
      });
      if (!cancelled) setSrc(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div className={className}>
      <div
        className="overflow-hidden rounded-xl bg-white p-2 shadow-lg"
        style={{ width: size, height: size }}
      >
        {src ? (
          <img src={src} alt={label ? `${label} 加入 QR Code` : "加入 QR Code"} width={size} height={size} />
        ) : null}
      </div>
      {label ? (
        <p className="mt-2 text-center text-sm font-medium text-muted-foreground">{label}</p>
      ) : null}
    </div>
  );
}
