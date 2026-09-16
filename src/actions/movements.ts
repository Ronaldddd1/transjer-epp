"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { requireActionUser } from "@/lib/auth";
import { movementSchema } from "@/lib/validations";
import { applyMovement } from "@/server/inventory";

export async function createMovement(formData: FormData): Promise<ActionResult> {
  try {
    const raw = formToObject(formData);
    const user = await requireActionUser(raw.type === "AJUSTE" ? "movements.adjust" : "movements.create");
    const data = movementSchema.parse(raw);
    await db.transaction((tx) => applyMovement(tx, { ...data, user }));
    revalidatePath("/", "layout");
    return { ok: true, message: "Stock actualizado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}
