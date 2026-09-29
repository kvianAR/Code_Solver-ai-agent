#!/bin/zsh
set -u
echo "Local server:"
if launchctl print "gui/$(id -u)/com.daily-solver.agent" >/dev/null 2>&1; then echo "  ON"; else echo "  OFF"; fi
echo "Sleep wake helper:"
if launchctl print system/com.daily-solver.wake >/dev/null 2>&1; then echo "  ON"; else echo "  OFF"; fi
echo "Scheduled Daily Solver wakes:"
pmset -g sched | grep -E 'Repeating power events|wakepoweron|wakeorpoweron|com\.daily-solver' || echo "  None"
