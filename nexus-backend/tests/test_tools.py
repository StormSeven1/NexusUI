import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tools import TRACKS, execute_tool


class ToolsAlignmentTests(unittest.TestCase):
    def test_track_catalog_matches_frontend_shape(self):
        self.assertEqual(len(TRACKS), 9)
        self.assertEqual(
            [track["id"] for track in TRACKS],
            [
                "TRK-001",
                "TRK-002",
                "TRK-003",
                "TRK-004",
                "TRK-005",
                "TRK-006",
                "TRK-007",
                "TRK-008",
                "TRK-009",
            ],
        )
        self.assertEqual({track["type"] for track in TRACKS}, {"air", "sea", "underwater"})
        self.assertFalse(any(track["type"] in {"ground", "unknown"} for track in TRACKS))
        self.assertFalse(any(track["disposition"] in {"suspect", "unknown", "assumed-friend"} for track in TRACKS))

    def test_query_tracks_filters_underwater_targets(self):
        result = execute_tool("query_tracks", {"type": "underwater"})

        self.assertEqual(result["count"], 2)
        self.assertEqual([track["id"] for track in result["tracks"]], ["TRK-004", "TRK-007"])

    def test_query_tracks_filters_friendly_targets(self):
        result = execute_tool("query_tracks", {"disposition": "friendly"})

        self.assertEqual(result["count"], 4)
        self.assertEqual([track["id"] for track in result["tracks"]], ["TRK-003", "TRK-005", "TRK-007", "TRK-008"])

    def test_highlight_tracks_supports_underwater_batch_selection(self):
        result = execute_tool("highlight_tracks", {"type": "underwater"})

        self.assertEqual(result["count"], 2)
        self.assertEqual(result["trackIds"], ["TRK-004", "TRK-007"])


if __name__ == "__main__":
    unittest.main()
