import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class HydrationSafetyTests(unittest.TestCase):
    def test_agent_message_float_does_not_read_window_during_render(self):
        text = (ROOT / 'nexus-ui/src/components/AgentMessageFloat.tsx').read_text(encoding='utf-8')
        self.assertNotIn('typeof window', text)
        self.assertIn("containerRef.current.getBoundingClientRect()", text)
        self.assertIn("right: `${rightSidebarWidth}px`", text)
        self.assertIn("bottom: `${statusBarHeight}px`", text)


if __name__ == '__main__':
    unittest.main()
