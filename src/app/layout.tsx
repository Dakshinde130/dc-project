import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Distributed Systems Lab — ten live protocols and algorithms",
  description:
    "An interactive distributed-systems lab covering TCP, UDP, XML-RPC, Java RMI, file sharing, Round Robin, Berkeley synchronization, Ricart–Agrawala, deadlock detection, and MapReduce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="lab-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
