// Feedback imediato ao trocar de tela: o menu responde na hora enquanto o servidor monta a página.
// Também deixa o <Link> pré-carregar este estado, então o clique nunca fica "parado".
export default function Carregando() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="animate-pulse">
      <div className="mb-6 h-9 w-48 rounded-xl bg-ink/5" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-ink/5" />
        ))}
      </div>
    </div>
  );
}
