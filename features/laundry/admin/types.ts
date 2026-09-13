// Tipi del dominio lavanderia lato admin — esportati da qui perché li usano
// anche altre schede (Segnalazioni, Ricorrenti) che agiscono su una macchina
// o leggono l'elenco delle lavanderie, non solo Macchine.

export type Machine = { code: string; kind: "washer" | "dryer"; oos: boolean; bookable: boolean };
export type Laundry = {
  id: number; slug: string; name: string;
  rooms: string;        // testo per chi legge, es. "dal 100 in su"
  sample_room: string;  // una camera qualsiasi, per le chiamate che ne hanno bisogno
  quota: number; reminders: string; week_start: string;
  bookings: number; machines: Machine[];
};
