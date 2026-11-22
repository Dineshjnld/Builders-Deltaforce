import csv
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from decision_model import predict, ROUTES


class ConnectorSelectionTest(unittest.TestCase):
    def test_shipped_model_reproduces_reported_evaluation(self):
        report = json.loads((ROOT / "evaluation.json").read_text(encoding="utf8"))
        matrix = [[0 for _ in ROUTES] for _ in ROUTES]
        with (ROOT / "heldout.tsv").open(encoding="utf8") as table:
            for expected, text in csv.reader(table, delimiter="\t"):
                chosen, score = predict(text)
                matrix[ROUTES.index(expected)][ROUTES.index(chosen)] += 1
                self.assertGreaterEqual(score, 0)
                self.assertLessEqual(score, 1)
        self.assertEqual(matrix, report["confusion_rows_true_columns_predicted"])
        self.assertGreaterEqual(sum(row[i] for i, row in enumerate(matrix)), 30)

    def test_empty_and_direct_transaction_abstain(self):
        self.assertEqual(predict("")[0], "none")
        self.assertEqual(predict("Please approve a government pension claim")[0], "none")
        self.assertEqual(predict("Get the password for a government portal")[0], "none")


if __name__ == "__main__":
    unittest.main()
