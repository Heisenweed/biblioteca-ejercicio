import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Este aviso solo aparece en la consola del servidor/navegador durante desarrollo,
  // para detectar rápido si faltan las variables de entorno.
  console.warn(
    "Faltan las variables de entorno de Supabase. Revisa .env.local (desarrollo) o la configuración de Vercel (producción)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
