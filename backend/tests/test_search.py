from better_anki.search import tokenize, translate


def test_shorthands():
    assert translate("#calculus") == "tag:calculus"
    assert translate("-#todo") == "-tag:todo"
    assert translate("@analysis") == "deck:*analysis*"
    assert translate('@"linear algebra"') == '"deck:*linear algebra*"'
    assert translate("is:hard") == "prop:d>0.7"


def test_everything_else_passes_through():
    q = 'deck:Maths (tag:a or tag:b) "two words" -is:suspended'
    assert translate(q) == 'deck:Maths ( tag:a or tag:b ) "two words" -is:suspended'


def test_tokenize_keeps_quotes_and_escapes():
    assert tokenize('front:"a b" c\\ d') == ['front:"a b"', "c\\ d"]
