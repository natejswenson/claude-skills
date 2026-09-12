import curses
import json
import pytest
import radar_terminal as radar


def board(n=7):
    return {'date': 'Today', 'ideas': [dict(id=i, title=f'Idea {i}', angle='Useful angle',
        lane='Project', signal='Today', status='Watchlist' if i == 5 else 'Ready')
        for i in range(1, n+1)]}


def test_expand_select_collapse_and_full_board():
    state = radar.Radar(board(100))
    assert len(state.ideas) == 3
    state.key(20)
    assert len(state.ideas) == 100
    for _ in range(99): state.key(curses.KEY_DOWN)
    state.key(10)
    assert state.selected == 100
    state.key(ord('t'))
    assert len(state.ideas) == 3 and state.selected == 100 and state.cursor == 2
    state.key(20)
    for _ in range(2): state.key(curses.KEY_DOWN)
    state.key(10)
    assert state.selected == 100
    state.key(curses.KEY_UP)
    state.key(10)
    assert state.selected == 4
    assert state.key(ord('q')) is False


@pytest.mark.parametrize('n', [0,1,3])
def test_small_boards(n):
    state=radar.Radar(board(n))
    for key in (20, curses.KEY_DOWN, curses.KEY_UP, 10, ord('x')): state.key(key)
    assert len(state.ideas)==n
    assert state.cursor==0


@pytest.mark.parametrize('number', [0, -1, True, '2', 2])
def test_invalid_ids(number):
    data=board(); data['ideas'][0]['id']=number
    with pytest.raises(ValueError): radar.Radar(data)


def test_status_and_text():
    data=board(); data['ideas'][0]['status']='Published'
    with pytest.raises(ValueError): radar.Radar(data)
    assert '\x1b' not in radar.clean('\x1b[2J\nhello\x07')


class Screen:
    def __init__(self, size=(18,80), keys=(), fail=False):
        self.size=size; self.keys=iter(keys); self.output=[]; self.fail=fail
    def getmaxyx(self): return self.size
    def erase(self): self.output=[]
    def addnstr(self,y,x,text,width):
        if self.fail: raise curses.error()
        self.output.append((y,text[:width]))
    def refresh(self): pass
    def keypad(self,value): assert value
    def getch(self): return next(self.keys)


def test_render_scroll_resize_and_empty():
    state=radar.Radar(board(100)); state.key(20)
    screen=Screen()
    radar.draw(screen,state)
    assert any('100 ideas' in text for _,text in screen.output)
    state.cursor=99; radar.draw(screen,state)
    assert any('Idea 100' in text for _,text in screen.output)
    state.cursor=0; radar.draw(screen,state)
    assert state.offset==0
    for size in ((4,20),(0,0),(18,80)):
        radar.draw(Screen(size,fail=True), state)
    screen=Screen(); radar.draw(screen,radar.Radar(board(0)))
    assert any('No ideas' in text for _,text in screen.output)


def test_interact(monkeypatch):
    monkeypatch.setattr(radar.curses,'curs_set',lambda _: None)
    assert radar.interact(Screen(keys=[20,10,ord('q')]),radar.Radar(board()))==1
    def fail(_): raise curses.error()
    monkeypatch.setattr(radar.curses,'curs_set',fail)
    assert radar.interact(Screen(keys=[ord('q')]),radar.Radar(board())) is None


def test_main(tmp_path,monkeypatch,capsys):
    path=tmp_path/'board.json'; args=['--file',str(path)]
    assert radar.main(args)==2
    path.write_text(json.dumps(board()))
    monkeypatch.setattr(radar.sys.stdin,'isatty',lambda: False)
    assert radar.main(args)==2
    monkeypatch.setattr(radar.sys.stdin,'isatty',lambda: True)
    monkeypatch.setattr(radar.sys.stdout,'isatty',lambda: True)
    for selection in (None,2):
        monkeypatch.setattr(radar.curses,'wrapper',lambda *a: selection)
        assert radar.main(args)==0
    assert 'Selected idea 2' in capsys.readouterr().out
    def fail(*a): raise KeyboardInterrupt()
    monkeypatch.setattr(radar.curses,'wrapper',fail)
    assert radar.main(args)==130
