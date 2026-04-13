import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


class DomainAlignmentTests(unittest.TestCase):
    def test_frontend_copy_no_legacy_callsigns(self):
        banned = [
            'SHARK-27', 'VIPER-03', 'BLUEJAY-12', 'FALCON-22', 'EAGLE-09', 'SHADOW-15',
            '不明车辆', '不明人员', '渔船 FV-Lucky'
        ]
        files = [
            'nexus-ui/src/lib/mock-data.ts',
            'nexus-ui/src/components/panels/EventLogPanel.tsx',
            'nexus-ui/src/components/panels/CommPanel.tsx',
            'nexus-ui/src/components/chat/ChatMessageList.tsx',
        ]
        text = '\n'.join(read(path) for path in files)
        for token in banned:
            self.assertNotIn(token, text)

    def test_frontend_panels_do_not_use_legacy_track_types(self):
        files = [
            'nexus-ui/src/components/panels/SituationOverview.tsx',
            'nexus-ui/src/components/panels/DataTablePanel.tsx',
            'nexus-ui/src/components/panels/TrackDetail.tsx',
        ]
        text = '\n'.join(read(path) for path in files)
        for token in ['ground', 'unknown']:
            self.assertNotIn(token, text)

    def test_system_prompt_mentions_current_domain(self):
        text = read('nexus-backend/services/llm.py')
        self.assertIn('空中、水面、水下目标', text)


if __name__ == '__main__':
    unittest.main()
