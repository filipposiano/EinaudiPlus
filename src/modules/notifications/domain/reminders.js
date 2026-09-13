// Una stanza può avere più promemoria dovuti nello stesso tick (più
// lavatrici nello stesso turno, o un turno il cui "sposta il bucato"
// coincide con il "il tuo turno inizia" di quello successivo). Senza questo
// raggruppamento arriverebbero N notifiche push separate sullo stesso
// dispositivo (o N messaggi Telegram) invece di una sola.

export function combineReminders(rows) {
  if (rows.length === 1) {
    return { title: rows[0].title, body: rows[0].body, tag: rows[0].tag };
  }
  const sameTitle = rows.every((r) => r.title === rows[0].title);
  return {
    title: sameTitle ? rows[0].title : "Bucato: piu' aggiornamenti",
    body: rows.map((r) => (sameTitle ? r.body : `${r.title} ${r.body}`)).join("\n"),
    tag: rows.map((r) => r.tag).join("+"),
  };
}
