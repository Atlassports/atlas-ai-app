// ========================================================
// Atlas AI — auth guard
// Redirects to /login.html if no session is present.
// Returns { user, profile } for pages that need them.
// ========================================================

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "/login.html";
    return null;
  }
  const user = session.user;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Could not load profile:", error.message);
  }

  return { user, profile };
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "/login.html";
}
