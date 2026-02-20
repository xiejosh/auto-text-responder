const { execSync } = require('child_process');

console.log('\niMessage Agent Setup\n');
console.log('This app needs permission to control Messages.app via AppleScript.');
console.log('\nPlease grant the following permissions:\n');
console.log('1. System Settings → Privacy & Security → Accessibility → Add Terminal');
console.log('2. System Settings → Privacy & Security → Automation → Terminal → Messages ✓');
console.log('\nPress Enter after granting permissions...');

process.stdin.once('data', () => {
  console.log('\nTesting Messages.app access...');
  try {
    const result = execSync('osascript -e "tell application \\"Messages\\" to get name"', {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    console.log(`Messages.app accessible: ${result}`);
    console.log('\nSetup complete! Run "npm start" to launch.\n');
  } catch (err) {
    console.error('Cannot access Messages.app. Please check permissions and try again.');
    process.exit(1);
  }
  process.exit(0);
});
