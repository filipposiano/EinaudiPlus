// Regola di confine fra moduli (vedi refactor-enterprise/ARCHITETTURA-ENTERPRISE.md,
// sezione 3): un modulo importa solo l'index.js di un altro modulo, mai i
// suoi file interni (domain/application/infrastructure). Prima era una
// convenzione rispettata a mano; qui diventa un errore di build.
//
// Deliberatamente scoperto solo src/modules/** — non tocca il frontend
// (App.tsx, AdminPanel.tsx...) né api/**, che non sono oggetto di questa
// regola.

import boundaries from "eslint-plugin-boundaries";

export default [
  {
    files: ["src/modules/**/*.js"],
    plugins: { boundaries },
    settings: {
      // Ogni cartella diretta sotto src/modules/ è un'istanza di tipo
      // "module": un file dentro src/modules/theme/** che importa un altro
      // file dentro la STESSA cartella non è considerato dipendenza fra
      // elementi diversi (non ricade sotto la policy sotto) — è la stessa
      // cosa di "un modulo importa liberamente se stesso".
      "boundaries/elements": [
        { type: "module", pattern: "src/modules/*" },
      ],
      "boundaries/files": [
        { category: "public", pattern: "**/index.js" },
      ],
    },
    rules: {
      "boundaries/dependencies": ["error", {
        default: "disallow",
        policies: [
          {
            from: { element: { type: "module" } },
            allow: { to: { file: { categories: "public" } } },
            message: "Un modulo non importa file interni di un altro modulo — solo il suo index.js.",
          },
        ],
      }],
    },
  },
];
