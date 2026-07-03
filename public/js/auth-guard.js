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

console.log("User ID:", user.id);
console.log("Profile:", profile);
console.log("Error object:", error);

if (error) {
  alert(
    `Profile fetch failed:\n\n` +
    JSON.stringify(error, null, 2)
  );
}

return { user, profile };
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = "/login.html";
}
