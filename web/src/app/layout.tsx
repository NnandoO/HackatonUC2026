import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bodoni-moda";
import "@fontsource-variable/work-sans";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Angibell Creaciones — ropa para niñas 0–14",
    template: "%s · Angibell",
  },
  description:
    "Catálogo vivo de Angibell Creaciones (Huancayo): prendas para niñas 0–14 con stock real del almacén. Demo SORYNTEL.",
};

export const viewport: Viewport = {
  themeColor: "#f6eddc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
