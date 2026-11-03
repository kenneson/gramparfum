import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const ui = Manrope({ variable: "--font-ui", subsets: ["latin"] });
const serif = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GamParfum",
  description: "Sistema de vendas GamParfum",
};

// cover + env(safe-area-inset-*): conteúdo desvia do notch e do indicador de início
export const viewport: Viewport = {
  themeColor: "#f6f3ec",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${ui.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster
          position="top-center"
          richColors
          closeButton
          mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
        />
      </body>
    </html>
  );
}
