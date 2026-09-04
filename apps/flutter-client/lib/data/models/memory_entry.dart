/// How Nexa classifies something she has kept.
enum MemoryKind {
  aboutYou('About you'),
  preference('Preference'),
  people('People'),
  work('Work');

  const MemoryKind(this.label);

  final String label;
}

/// One thing Nexa remembers.
class MemoryEntry {
  const MemoryEntry({
    required this.id,
    required this.text,
    required this.when,
    required this.kind,
    this.important = false,
    this.source = 'from a conversation',
  });

  final String id;

  /// What she remembers, written the way she would say it back.
  final String text;

  /// Relative time, already humanised — 'today', 'always', '3 days ago'.
  final String when;

  final MemoryKind kind;

  /// Whether it is something she should weight heavily.
  final bool important;

  /// Where it came from, shown on the detail screen.
  final String source;
}

/// The filters the Memory screen offers across the collection.
enum MemoryFilter {
  recent('Recent'),
  important('Important'),
  people('People'),
  preferences('Preferences');

  const MemoryFilter(this.label);

  final String label;
}
