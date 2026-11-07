import { redirect } from "next/navigation";

/**
 * Categorías salió del menú: la categoría de un EPP se elige o se escribe al cargar el
 * producto, y si es nueva se crea sola. Quien llegue por un enlace viejo va al inventario.
 */
export default function CategoriesPage() {
  redirect("/inventario");
}
