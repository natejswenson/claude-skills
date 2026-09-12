#!/usr/bin/env python3
"""Browse an idea board entirely in an interactive terminal."""
import argparse
import curses
import json
from pathlib import Path
import sys
import textwrap


def clean(value):
    """Prevent board text from injecting terminal control sequences."""
    return ''.join(c if c.isprintable() else ' ' for c in str(value))


def validate(board):
    seen = set()
    for idea in board['ideas']:
        number = idea['id']
        if type(number) is not int or number < 1 or number in seen:
            raise ValueError('Idea IDs must be unique positive integers')
        seen.add(number)
        if idea['status'] not in ('Ready', 'Watchlist', 'Stale'):
            raise ValueError('Status must be Ready, Watchlist, or Stale')
        for field in ('title', 'angle', 'lane', 'signal'):
            idea[field]  # require complete rows before entering the terminal
    return board


class Radar:
    def __init__(self, board):
        self.board = validate(board)
        self.expanded = False
        self.cursor = 0
        self.selected = None
        self.offset = 0

    @property
    def ideas(self):
        rows = self.board['ideas']
        return rows if self.expanded else rows[:3]

    def key(self, key):
        if key in (ord('q'), 27, 3):
            return False
        if key in (20, ord('t')):
            self.expanded = not self.expanded
            self.cursor = min(self.cursor, max(0, len(self.ideas) - 1))
            self.offset = 0
        elif key in (curses.KEY_DOWN, ord('j')):
            self.cursor = min(self.cursor + 1, max(0, len(self.ideas) - 1))
        elif key in (curses.KEY_UP, ord('k')):
            self.cursor = max(0, self.cursor - 1)
        elif key in (10, 13, ord(' ')) and self.ideas:
            idea = self.ideas[self.cursor]
            if idea['status'] == 'Ready':
                self.selected = idea['id']
        return True

    def lines(self, width):
        result = []
        current = 0
        for index, idea in enumerate(self.ideas):
            if index == self.cursor:
                current = len(result)
            prefix = ('>' if index == self.cursor else ' ') + ('*' if idea['id'] == self.selected else ' ')
            text = f"{prefix} {idea['id']} | {clean(idea['title'])} | {clean(idea['status'])}"
            detail = f"   {clean(idea['angle'])} | {clean(idea['lane'])} | {clean(idea['signal'])}"
            result.extend(textwrap.wrap(text, max(1, width), subsequent_indent='  ') or [''])
            result.extend(textwrap.wrap(detail, max(1, width), subsequent_indent='  ') or [''])
            result.append('')
        return result, current


def draw(screen, state):
    height, width = screen.getmaxyx()
    screen.erase()
    def put(y, value):
        if 0 <= y < height and width > 1:
            try:
                screen.addnstr(y, 0, clean(value), width - 1)
            except curses.error:
                pass  # wide characters or a resize may hit the terminal boundary
    if height < 7 or width < 24:
        put(0, 'Enlarge terminal; q exits')
    else:
        put(0, f"ghostwriter · ideas | {clean(state.board.get('date', ''))}")
        put(1, f"{len(state.ideas)} of {len(state.board['ideas'])} ideas | {'Expanded' if state.expanded else 'Collapsed'}")
        put(2, '   # | Idea / angle / signal | Status')
        lines, current = state.lines(width - 1)
        room = height - 6
        if current < state.offset:
            state.offset = current
        elif current >= state.offset + room:
            state.offset = current - room + 1
        state.offset = min(state.offset, max(0, len(lines) - room))
        for y, line in enumerate(lines[state.offset:state.offset + room], 3):
            put(y, line)
        if not lines:
            put(3, 'No ideas yet. Refresh the radar.')
        put(height - 3, f"Selected: {state.selected or 'none'} | Ready ideas only")
        put(height - 2, 'Ctrl+T / t expand · arrows / j k move')
        put(height - 1, 'Enter select · q exit (never publishes)')
    screen.refresh()


def interact(screen, state):
    screen.keypad(True)
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    while True:
        draw(screen, state)
        if not state.key(screen.getch()):
            return state.selected


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--file', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        state = Radar(json.loads(args.file.read_text()))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'Cannot load radar: {clean(error)}', file=sys.stderr)
        return 2
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        print('Interactive terminal required. Show the board in terminal chat and accept more/fewer.', file=sys.stderr)
        return 2
    try:
        selected = curses.wrapper(interact, state)
    except (KeyboardInterrupt, curses.error):
        return 130
    print(f'Selected idea {selected}. Reply with {selected} in ghostwriter to draft it.' if selected else 'Radar closed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
