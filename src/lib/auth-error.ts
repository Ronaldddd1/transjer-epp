/**
 * Error de sesión o de permisos.
 *
 * Vive en su propio archivo para que la lógica de servidor (acciones, facturas, correo)
 * pueda usarlo sin arrastrar el módulo de sesión, que depende de las cookies y del
 * enrutador de Next.
 */
export class AuthError extends Error {}
