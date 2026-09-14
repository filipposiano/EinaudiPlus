// Tipi condivisi da tutta la sezione amministrativa — vivono qui perché ogni
// dominio (account, macchine, sale, bici, notifiche...) li usa per sapere chi
// sta chiedendo (Role) o dove si trova (Tab), non solo il guscio in
// AdminPanel.tsx che li ri-esporta per chi importava da lì.

// `staff` ha gli stessi poteri di `fdo`; solo `sistemista` puo' di piu'.
// Restano account distinti perche' l'audit log registra chi ha fatto cosa.
export type Role = "fdo" | "staff" | "sistemista";
export type Tab = "macchine" | "segnalazioni" | "bici" | "account" | "ricorrenti" | "notifiche" | "manutenzione" | "tema";
