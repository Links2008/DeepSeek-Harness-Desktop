const APP_ID = "com.deepseek.dsh";

function shouldNotifyTaskCompletion() {
  return true;
}

function sanitizeTaskTitle(value) {
  return typeof value === "string" ? value.slice(0, 120) : "";
}

function nextMaximizeCommand(isMaximized) {
  return isMaximized ? "unmaximize" : "maximize";
}

module.exports = {
  APP_ID,
  nextMaximizeCommand,
  sanitizeTaskTitle,
  shouldNotifyTaskCompletion,
};
