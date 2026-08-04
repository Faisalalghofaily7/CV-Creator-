// Generates a bcrypt hash for the admin password, without ever writing the
// plain-text password to disk, shell history, or this repo.
//
// Usage:
//   node scripts/hash-password.mjs
//   (then type your password — it won't be echoed to the terminal)
//
// Copy the printed ADMIN_PASSWORD_HASH line into Vercel's environment
// variables and your local .env.development.local.
import bcrypt from "bcryptjs";
import readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const originalWrite = rl._writeToOutput.bind(rl);

// Callback-style (not async/await) on purpose: an await between two
// rl.question() calls introduces a microtask gap, and if the next line is
// already buffered (e.g. piped input), readline can emit and drop it before
// the next question() listener is attached. Chaining callbacks keeps each
// question() call synchronous with the previous one's answer.
function promptHidden(question, callback) {
  rl._writeToOutput = (str) => {
    originalWrite(str.startsWith(question) ? str : "*");
  };
  rl.question(question, (answer) => {
    rl._writeToOutput = originalWrite;
    rl.output.write("\n");
    callback(answer);
  });
}

promptHidden("Enter the admin password to hash: ", (password) => {
  if (!password) {
    console.error("No password entered.");
    rl.close();
    process.exit(1);
  }
  promptHidden("Confirm the password: ", (confirm) => {
    rl.close();
    if (confirm !== password) {
      console.error("Passwords didn't match — try again.");
      process.exit(1);
    }
    bcrypt.hash(password, 12).then((hash) => {
      console.log("\nADMIN_PASSWORD_HASH=" + hash);
      console.log("\nCopy the line above into Vercel's environment variables and your .env.development.local — never the plain password.");
    });
  });
});
