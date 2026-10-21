"""Source-informed university syllabi adapted for a deterministic planning demo.

Dates and criterion point splits are authored examples, not university deadlines or
published marking schemes. Policies stay in syllabus text; the terminal's weight
model does not evaluate drop rules, grade curves, or participation requirements.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from .models import (
    CategoryWeight,
    RubricCriterion,
    StrictModel,
    SyllabusCourse,
    SyllabusDeliverable,
    SyllabusExtraction,
)


class SyllabusPresetDescriptor(StrictModel):
    id: str
    university: str
    course_code: str
    name: str
    term: str
    description: str
    summary: str
    source_urls: list[str]
    adaptation_notes: str
    category_weights: list[CategoryWeight]
    assignment_count: int


class SyllabusPreset(StrictModel):
    descriptor: SyllabusPresetDescriptor
    extraction: SyllabusExtraction
    syllabus_text: str


_ADAPTATION = (
    "Educational planning preset inspired by the linked public course materials. "
    "All due dates, assignment topic groupings, and criterion point splits are authored "
    "Fall 2026 demo adaptations, not official university requirements. "
    "Any adapted grading policies are identified below. Category and assignment weights "
    "are nominal planning weights; the terminal does not calculate drops, alternate "
    "exam formulas, participation gates, or letter grades."
)


def _item(title, category, date, weight, description, criteria, *, zone="America/New_York"):
    return SyllabusDeliverable(
        title=title,
        category=category,
        due_at=datetime.fromisoformat(date).replace(tzinfo=ZoneInfo(zone)),
        weight=float(weight),
        points_possible=100.0,
        description=description,
        rubric_criteria=[
            RubricCriterion(name=name, description=text, points=float(points))
            for name, text, points in criteria
        ],
    )


def _preset(identifier, university, code, name, description, sources, weights, policy, items):
    categories = [
        CategoryWeight(name=category, weight=float(weight)) for category, weight in weights
    ]
    descriptor = SyllabusPresetDescriptor(
        id=identifier,
        university=university,
        course_code=code,
        name=name,
        term="Fall 2026 (adapted demo)",
        description=description,
        summary=description,
        source_urls=sources,
        adaptation_notes=_ADAPTATION,
        category_weights=categories,
        assignment_count=len(items),
    )
    text = "\n\n".join(
        [
            f"{university} — {code}: {name}\n{descriptor.term}\n{description}",
            _ADAPTATION,
            "Sources:\n" + "\n".join(sources),
            "Grading categories:\n" + "\n".join(f"{c.name}: {c.weight:g}%" for c in categories),
            "Grading policy:\n" + policy,
            "Due dates and rubric criteria (adapted demo):\n"
            + "\n\n".join(
                f"{a.title} | {a.category} | due {a.due_at.isoformat()} | "
                f"{a.weight:g}% of course | {a.points_possible:g} points\n"
                + a.assignment_description
                for a in items
            ),
        ]
    )
    return SyllabusPreset(
        descriptor=descriptor,
        extraction=SyllabusExtraction(
            course=SyllabusCourse(course_code=code, name=name, category_weights=categories),
            deliverables=items,
        ),
        syllabus_text=text,
    )


_SYSTEMS = [
    ("Technical correctness", "Explain mechanisms and state assumptions and failure modes.", 50),
    ("Evidence and tradeoffs", "Use measurements or examples to justify design choices.", 30),
    ("Communication", "Present a clear argument with readable diagrams and citations.", 20),
]
_ML = [
    ("Derivation", "Derive the objective, gradients, and assumptions correctly.", 40),
    ("Implementation", "Provide reproducible code and numerically sound experiments.", 35),
    ("Evaluation", "Compare a baseline and explain metrics, errors, and limitations.", 25),
]
_PROBABILITY = [
    ("Model and events", "Define the sample space, random variables, and assumptions.", 25),
    ("Mathematical reasoning", "Justify conditioning, independence, and each theorem used.", 50),
    ("Result and interpretation", "Check calculations and interpret the probability.", 25),
]
_BIOLOGY = [
    ("Mechanism", "Explain the molecular mechanism with correct causal steps.", 45),
    ("Experimental reasoning", "Predict results using controls and interpret evidence.", 35),
    ("Scientific clarity", "Use precise terminology and clearly labeled diagrams.", 20),
]


def _mit():
    hands = [
        ("UNIX and processes", "09-11"),
        ("Virtual memory", "09-18"),
        ("Threads and synchronization", "09-25"),
        ("Naming and DNS", "10-02"),
        ("Internet routing", "10-09"),
        ("Congestion control", "10-23"),
        ("RPC and distributed services", "10-30"),
        ("Crash recovery", "11-06"),
        ("Transactions", "11-13"),
        ("Security and authentication", "11-20"),
    ]
    items = [
        _item(
            f"Hands-on {i}: {topic}",
            "Hands-ons",
            f"2026-{day}T23:59:00",
            0.5,
            f"Run a small systems experiment on {topic.lower()} and explain observed behavior.",
            _SYSTEMS,
        )
        for i, (topic, day) in enumerate(hands, 1)
    ]
    for title, category, day, weight, task in [
        (
            "Quiz 1: operating systems and networks",
            "Quizzes",
            "10-15",
            15,
            "Solve individual questions on concurrency, virtual memory, naming, and networking.",
        ),
        (
            "Quiz 2: distributed systems and security",
            "Quizzes",
            "12-16",
            15,
            "Analyze reliability, transactions, consistency, and security of distributed systems.",
        ),
        (
            "Design project: preliminary report",
            "Design project",
            "10-16",
            5,
            "Specify requirements, architecture, interfaces, failure assumptions, "
            "and alternatives.",
        ),
        (
            "Design project: oral presentation",
            "Design project",
            "11-13",
            5,
            "Present the design, defend tradeoffs, and answer technical questions as a team.",
        ),
        (
            "Design project: final report",
            "Design project",
            "12-04",
            20,
            "Deliver a coherent system design with capacity analysis and failure recovery.",
        ),
        (
            "Design project: peer review",
            "Design project",
            "12-08",
            4,
            "Evaluate another team's design and give actionable evidence-based feedback.",
        ),
        (
            "System critique 1: end-to-end arguments",
            "System critiques",
            "09-24",
            2,
            "Critique placement of functionality and identify costs of an alternative design.",
        ),
        (
            "System critique 2: distributed storage",
            "System critiques",
            "11-05",
            4,
            "Assess a storage design's consistency, availability, and failure behavior.",
        ),
        (
            "Recitation participation portfolio",
            "Recitation participation",
            "12-10",
            20,
            "Collect reading questions and demonstrate sustained prepared discussion.",
        ),
        (
            "Communication tutorial portfolio",
            "Communication participation",
            "12-11",
            5,
            "Document revision, tutorial preparation, and constructive peer feedback.",
        ),
    ]:
        items.append(_item(title, category, f"2026-{day}T17:00:00", weight, task, _SYSTEMS))
    return _preset(
        "mit-6-033",
        "MIT",
        "6.033",
        "Computer System Engineering",
        "Operating systems, networks, distributed systems, security, and technical design.",
        ["https://web.mit.edu/6.033/2019/wwwdocs/general.shtml"],
        [
            ("Quizzes", 30),
            ("Hands-ons", 5),
            ("Design project", 34),
            ("System critiques", 6),
            ("Recitation participation", 20),
            ("Communication participation", 5),
        ],
        "Uses the Spring 2019 grading breakdown. All design project deliverables must be "
        "completed to pass. Quizzes are individual; discuss hands-on concepts but write your "
        "own answers. Cite contributions in writing. Ordinary late work receives feedback "
        "but no grade credit unless an exception is arranged in advance. Project late terms "
        "are assignment-specific; this demo requires an approved extension before the deadline. "
        "The combined 10% preliminary-report/presentation component is split 5%/5% here. "
        "Participation is assessed across the term and recorded at the portfolio deadline. "
        "Letter grades require instructor judgment; there are no invented numeric cutoffs.",
        items,
    )


def _stanford():
    zone = "America/Los_Angeles"
    items = [
        _item(
            f"Problem set {i}: {topic}",
            "Homework",
            f"2026-{day}T23:59:00",
            10,
            f"Derive and implement methods for {topic.lower()}; submit solutions and code.",
            _ML,
            zone=zone,
        )
        for i, (topic, day) in enumerate(
            [
                ("Supervised learning and regression", "10-07"),
                ("Classification and kernels", "10-21"),
                ("Learning theory and regularization", "11-04"),
                ("Unsupervised learning and reinforcement learning", "11-18"),
            ],
            1,
        )
    ]
    for title, category, day, weight, task in [
        (
            "Midterm exam",
            "Midterm",
            "11-06",
            20,
            "Individually solve derivation and conceptual problems on supervised learning.",
        ),
        (
            "Project proposal",
            "Project",
            "10-16",
            2,
            "Define a question, dataset, baseline, evaluation protocol, and team responsibilities.",
        ),
        (
            "Project milestone",
            "Project",
            "11-13",
            8,
            "Report preliminary baseline results, implementation progress, "
            "and revised experiments.",
        ),
        (
            "Project poster",
            "Project",
            "12-04",
            5,
            "Explain the problem, method, results, and limitations to a technical audience.",
        ),
        (
            "Project final report and code",
            "Project",
            "12-11",
            25,
            "Submit a reproducible study with baselines, ablations, error analysis, and citations.",
        ),
    ]:
        items.append(_item(title, category, f"2026-{day}T23:59:00", weight, task, _ML, zone=zone))
    return _preset(
        "stanford-cs229",
        "Stanford",
        "CS229",
        "Machine Learning",
        "Supervised and unsupervised learning, learning theory, and an open-ended ML project.",
        ["https://cs229.stanford.edu/materials/handout.pdf"],
        [("Homework", 40), ("Midterm", 20), ("Project", 40)],
        "The public course handout assigns 10% to each of four homeworks, 20% to the "
        "midterm, and 40% to a project for teams of up to three. Homework discussion is "
        "allowed, but solutions must be independently reconstructed and collaborators named. "
        "Project milestone splits (2/8/5/25), the following late rules, and exam arrangements "
        "are demo adaptations: three homework late days total, at most one per homework; "
        "then 25% of earned credit deducted per calendar day, with zero after four days. "
        "No project late days; arrange documented exceptions before deadlines. Missing work "
        "earns zero, no homework is dropped, and the midterm is individual and closed book. "
        "No fixed letter-grade thresholds are asserted; instructor review determines them.",
        items,
    )


def _harvard():
    topics = [
        ("Counting and sample spaces", "09-11"),
        ("Conditional probability and Bayes", "09-18"),
        ("Independence and discrete random variables", "09-25"),
        ("Expectation and indicator variables", "10-02"),
        ("Continuous distributions", "10-16"),
        ("Joint distributions", "10-23"),
        ("Conditional expectation", "10-30"),
        ("Transformations and moment generating functions", "11-06"),
        ("Laws of large numbers and central limit theorem", "11-13"),
        ("Markov chains", "11-20"),
    ]
    items = [
        _item(
            f"Problem set {i}: {topic}",
            "Homework",
            f"2026-{day}T17:00:00",
            4.5,
            f"Solve probability problems on {topic.lower()} with complete reasoning.",
            _PROBABILITY,
        )
        for i, (topic, day) in enumerate(topics, 1)
    ]
    items += [
        _item(
            "Midterm exam",
            "Midterm",
            "2026-10-08T14:45:00",
            20,
            "Solve individual probability problems through expectation and discrete models.",
            _PROBABILITY,
        ),
        _item(
            "Cumulative final exam",
            "Final",
            "2026-12-16T12:00:00",
            35,
            "Integrate conditioning, distributions, limit theorems, and Markov chains.",
            _PROBABILITY,
        ),
    ]
    return _preset(
        "harvard-stat110",
        "Harvard",
        "STAT 110",
        "Introduction to Probability",
        "Probability models, random variables, expectation, conditioning, and Markov chains.",
        ["https://stat110.hsites.harvard.edu/", "https://stat110.hsites.harvard.edu/handouts"],
        [("Homework", 45), ("Midterm", 20), ("Final", 35)],
        "Planning grading policy (adapted; the public learning site does not publish a "
        "current enrolled-course grading contract): homework 45%, midterm 20%, final 35%. "
        "Ten equally weighted problem sets, no drops or alternate exam weighting in this "
        "demo. Homework is due Friday at 17:00 Eastern; two 48-hour homework extensions "
        "are allowed, then late submissions earn zero. Exams have no automatic extensions; "
        "arrange documented accommodations in advance. Discuss ideas with peers but write "
        "independent solutions and acknowledge collaborators; do not copy solution manuals. "
        "Exams are individual, closed book, with two double-sided note sheets at the midterm "
        "and four at the final; no electronic devices. Missing work earns zero. Demo grade "
        "bands: A >=85, B >=65, C >=55, D >=45, otherwise F; these are planning bands, "
        "not an assertion about current Harvard grading or plus/minus grades.",
        items,
    )


def _columbia():
    items = [
        _item(
            f"Exam {i}: {topic}",
            "Term exams",
            f"2026-{day}T19:30:00",
            20,
            f"Apply molecular reasoning to new experimental problems on {topic.lower()}.",
            _BIOLOGY,
        )
        for i, (topic, day) in enumerate(
            [
                ("Proteins, enzymes, and energetics", "10-01"),
                ("Metabolism and molecular genetics", "10-29"),
                ("Gene expression and genetic analysis", "12-03"),
            ],
            1,
        )
    ]
    items.append(
        _item(
            "Cumulative final exam",
            "Final",
            "2026-12-18T12:00:00",
            40,
            "Analyze integrated problems in biochemistry, genetics, and molecular biology.",
            _BIOLOGY,
        )
    )
    for i, (topic, day) in enumerate(
        [
            ("Chemical bonds and water", "09-11"),
            ("Protein structure", "09-18"),
            ("Enzyme kinetics", "09-25"),
            ("Energy and metabolism", "10-09"),
            ("DNA replication", "10-16"),
            ("Transcription", "10-23"),
            ("Translation", "11-06"),
            ("Gene regulation", "11-13"),
            ("Mendelian genetics", "11-20"),
            ("Experimental genetics", "12-04"),
        ],
        1,
    ):
        items.append(
            _item(
                f"Recitation quiz {i}: {topic}",
                "Recitation requirement",
                f"2026-{day}T17:00:00",
                0,
                f"Prepare problem-book exercises and demonstrate understanding of {topic.lower()}. "
                "This quiz is one of ten participation checks; its 100-point score contributes "
                "one tenth of the 100-point recitation requirement, not to the exam average.",
                _BIOLOGY,
            )
        )
    return _preset(
        "columbia-bio-c2005",
        "Columbia",
        "BIO C2005",
        "Introduction to Molecular and Cellular Biology I",
        "Biochemistry, genetics, and molecular biology; "
        "the first course in the cell biology sequence.",
        [
            "https://www.columbia.edu/cu/biology/courses/c2005/faqs.html",
            "https://www.columbia.edu/cu/biology/courses/c2005/regrades.html",
        ],
        [("Term exams", 60), ("Final", 40), ("Recitation requirement", 0)],
        "C2005 requires recitation with weekly quizzes and at least 60 recitation points; "
        "exam grade scales are shared with F2401 and may be lowered, never raised, if exams "
        "are too difficult. This preset adapts the numerical breakdown to three 20% term "
        "exams and a 40% cumulative final; no exam drops. Recitation is a separate completion "
        "requirement: ten quizzes are normalized to 10 points each, with 60/100 required. "
        "Its 0% category does not waive that requirement. Term exams and final must be "
        "attempted; missed assessments earn zero without an approved accommodation. No "
        "automatic late quizzes or makeup exams in this demo; arrange exceptions in advance. "
        "Independent exam answers and scientific explanations are required. Regrade requests "
        "are due within one week of return and can change the entire exam score. Actual "
        "letter cutoffs are instructor-set, not represented as a fixed terminal formula. "
        "Despite the common Cell Bio shorthand, C2005 emphasizes biochemistry and genetics; "
        "the second course covers much of cell physiology.",
        items,
    )


_PRESETS = {
    preset.descriptor.id: preset for preset in (_mit(), _stanford(), _harvard(), _columbia())
}


def list_presets() -> list[SyllabusPresetDescriptor]:
    return [preset.descriptor.model_copy(deep=True) for preset in _PRESETS.values()]


def get_preset(preset_id: str) -> SyllabusPreset:
    """Return an isolated copy so loading or editing state cannot mutate the catalog."""
    return _PRESETS[preset_id].model_copy(deep=True)
