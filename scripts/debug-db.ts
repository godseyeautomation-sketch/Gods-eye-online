
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log("URL:", supabaseUrl);
console.log("Key Length:", supabaseKey?.length);

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkData() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log("Current Auth User (Server-Side):", user?.id || "None (Anon)");

    const { data, error } = await supabase
        .from('user_generations')
        .select('*')
        .limit(5);

    if (error) {
        console.error("DB Error:", error);
    } else {
        console.log("Rows found:", data?.length);
        if (data?.length > 0) {
            console.log("Sample Data URL:", data[0].content_url);
        }
    }
}

checkData();
