import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const ui = Geist({ variable: "--font-ui", subsets: ["latin"] });

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
    <html lang="pt-BR" className={`${ui.variable} h-full antialiased`}>
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
