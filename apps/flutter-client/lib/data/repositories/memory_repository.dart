import '../models/memory_entry.dart';

/// Reads and edits what Nexa keeps.
///
/// The Memory screens depend on this rather than on any concrete list, so the
/// real memory service can replace it without touching the UI.
abstract interface class MemoryRepository {
  List<MemoryEntry> all();

  /// Entries matching a filter, newest first.
  List<MemoryEntry> byFilter(MemoryFilter filter);

  MemoryEntry? byId(String id);

  int get count;

  /// How many entries Nexa is weighting heavily.
  int get importantCount;

  /// The distinct people she knows about.
  int get peopleCount;

  /// Forget one thing. Permanent from the user's point of view.
  void forget(String id);

  /// Forget everything.
  void forgetAll();
}

/// A deterministic in-memory set of entries.
///
/// Local demo data, not backend state — a restart brings all of it back, and
/// forgetting something here does not reach any server.
class LocalMemoryRepository implements MemoryRepository {
  LocalMemoryRepository();

  final List<MemoryEntry> _entries = [
    const MemoryEntry(
      id: 'm1',
      text: 'You are happiest working late, and slower before ten.',
      when: 'today',
      kind: MemoryKind.preference,
      important: true,
    ),
    const MemoryEntry(
      id: 'm2',
      text: 'The launch is on the fourteenth, and you want that morning clear.',
      when: 'today',
      kind: MemoryKind.work,
      important: true,
    ),
    const MemoryEntry(
      id: 'm3',
      text: 'Your sister visits on Sundays.',
      when: 'always',
      kind: MemoryKind.people,
      important: true,
    ),
    const MemoryEntry(
      id: 'm4',
      text: 'Say less unless asked for detail.',
      when: 'always',
      kind: MemoryKind.preference,
      important: true,
    ),
    const MemoryEntry(
      id: 'm5',
      text: 'Sam plays guitar with you on weekends.',
      when: 'often',
      kind: MemoryKind.people,
    ),
    const MemoryEntry(
      id: 'm6',
      text: 'Mara reviews your design work before it goes out.',
      when: 'often',
      kind: MemoryKind.people,
    ),
    const MemoryEntry(
      id: 'm7',
      text: 'No music while you work.',
      when: 'always',
      kind: MemoryKind.preference,
    ),
    const MemoryEntry(
      id: 'm8',
      text: 'Wake you gently, never with an alarm.',
      when: 'always',
      kind: MemoryKind.preference,
    ),
    const MemoryEntry(
      id: 'm9',
      text: 'You learned to sail the summer you turned nineteen.',
      when: '2 weeks ago',
      kind: MemoryKind.aboutYou,
    ),
    const MemoryEntry(
      id: 'm10',
      text: 'You would rather be told the hard thing first.',
      when: '3 days ago',
      kind: MemoryKind.preference,
      important: true,
    ),
  ];

  @override
  List<MemoryEntry> all() => List.unmodifiable(_entries);

  @override
  List<MemoryEntry> byFilter(MemoryFilter filter) => switch (filter) {
    MemoryFilter.recent => List.unmodifiable(_entries),
    MemoryFilter.important =>
      _entries.where((e) => e.important).toList(growable: false),
    MemoryFilter.people => _entries
        .where((e) => e.kind == MemoryKind.people)
        .toList(growable: false),
    MemoryFilter.preferences => _entries
        .where((e) => e.kind == MemoryKind.preference)
        .toList(growable: false),
  };

  @override
  MemoryEntry? byId(String id) {
    for (final e in _entries) {
      if (e.id == id) return e;
    }
    return null;
  }

  @override
  int get count => _entries.length;

  @override
  int get importantCount => _entries.where((e) => e.important).length;

  @override
  int get peopleCount =>
      _entries.where((e) => e.kind == MemoryKind.people).length;

  @override
  void forget(String id) => _entries.removeWhere((e) => e.id == id);

  @override
  void forgetAll() => _entries.clear();
}
