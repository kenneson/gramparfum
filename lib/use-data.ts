"use client";

import { useCallback, useEffect, useState } from "react";

// Busca no cliente com descarte de respostas antigas. `fetcher` deve vir de useCallback.
export function useData<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    fetcher().then((d) => {
      if (vivo) setData(d);
    });
    return () => {
      vivo = false;
    };
  }, [fetcher, versao]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return [data, recarregar, setData] as const;
}
