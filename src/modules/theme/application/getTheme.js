// Use-case: legge il tema stagionale attivo (pannello admin).

export async function getTheme(_input, { themeRepository }) {
  return { ok: true, tema: await themeRepository.get() };
}
