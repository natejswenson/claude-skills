"""Two-sided review protocol tests, not aesthetic or AI-authorship scores.

PNG fixtures and editor attestations here are synthetic. Real visual judgment
requires the independent pixel inspection described in the skill.
"""
import json
import struct
import sys
import zlib
from pathlib import Path

import pytest
import visual_review as review
import post_review
from test_post_review import reviewed, ROOT, OTHER_ROOT


def png(path, width=1200, height=1500):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress((b'\0' + b'\xff' * width) * height)) + chunk(b'IEND', b''))
    return path


def candidate(tmp_path):
    path, _, voice, samples = reviewed(tmp_path)
    image = png(tmp_path / 'card.png')
    receipt = tmp_path / 'card.image.json'
    review.write_json(receipt, dict(generator=review.GENERATOR, post_anchor=path.read_text().splitlines()[0],
                                   visual_claim='The write check precedes saving.', prompt='Synthetic protocol fixture.',
                                   exact_text=['Write check', 'Stop before saving'], alt_text='A check before a write.', tweet_index=1,
                                   export={'min_width': 1200, 'min_height': 1500},
                                   quality_brief={'finish': 'Synthetic crisp output requirement.',
                                                  'focal_idea': 'Synthetic purposeful spatial comparison.',
                                                  'reference_basis': 'Synthetic brand; no approved reference.'}))
    brand = tmp_path / 'brand.css'
    brand.write_text('Synthetic brand evidence, not a rendered brand assertion.')
    record = review.prepare(path, image, receipt, [brand], [samples])
    record['reviewer'] = 'session-visual-editor'
    record['revision_required'] = False
    record['inspection'] = {'full_resolution': 'Synthetic full view attestation.',
                            'feed_360px': 'Synthetic feed view attestation.',
                            'craft': 'Synthetic reference comparison and strengths/weaknesses, not aesthetic evidence.'}
    record['observed_text'] = ['Write check', 'Stop before saving']
    for key in review.RUBRIC:
        record['checks'][key] = dict(status='pass', region='Synthetic hero region', reason=f'Synthetic {key} protocol attestation.')
    review.write_json(review.sidecar(image), record)
    return path, image, receipt, brand, record


def test_bundled_gate_and_reference_are_identical():
    for relative in ('scripts/visual_review.py', 'references/visual-review.md'):
        assert (ROOT / relative).read_bytes() == (OTHER_ROOT / relative).read_bytes()


def test_clean_review_pass_and_prepare_resets_all_checks(tmp_path):
    path, image, receipt, brand, record = candidate(tmp_path)
    assert review.validate(path, image)['ok']
    review.enforce(path, [(image, 'A check before a write.')])
    pending = review.prepare(path, image, receipt, [brand], [brand])
    assert all(c['status'] == 'pending' for c in pending['checks'].values())
    assert not review.validate(path, image)['ok']


@pytest.mark.parametrize('key', review.RUBRIC)
def test_each_visual_dimension_is_required(tmp_path, key):
    path, image, _, _, record = candidate(tmp_path)
    record['checks'][key]['status'] = 'fail'
    review.write_json(review.sidecar(image), record)
    result = review.validate(path, image)
    assert not result['ok'] and any(key in error for error in result['errors'])


@pytest.mark.parametrize('change', ['version', 'platform', 'origin', 'image', 'dimensions', 'reviewer', 'full_resolution', 'feed_360px', 'craft', 'region', 'reason', 'quote_only'])
def test_incomplete_or_mismatched_review_blocks(tmp_path, change):
    path, image, _, _, record = candidate(tmp_path)
    if change in ('version', 'platform'):
        record[change] = 'wrong'
    elif change == 'origin':
        record['generator'] = 'legacy'
    elif change in ('image', 'dimensions'):
        record[change] = {}
    elif change == 'reviewer':
        record['reviewer'] = 'mock'
    elif change in record['inspection']:
        record['inspection'][change] = ''
    elif change == 'quote_only':
        record['checks']['post_alignment'] = {'status': 'pass', 'quote': 'a prompt quote'}
    else:
        record['checks']['post_alignment'][change] = ''
    review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']


@pytest.mark.parametrize('role', ['draft', 'text_review', 'sources', 'receipt', 'brand', 'evidence'])
@pytest.mark.parametrize('mode', ['changed', 'empty', 'deleted', 'drop'])
def test_all_context_is_bound_and_required(tmp_path, role, mode):
    path, image, _, _, record = candidate(tmp_path)
    target = Path(record['context'][role][0]['path'])
    if mode == 'changed':
        target.write_text(target.read_text() + '\nchanged')
    elif mode == 'empty':
        target.write_text('')
    elif mode == 'deleted':
        target.unlink()
    else:
        record['context'][role] = []
        review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']


@pytest.mark.parametrize('replacement', [None, {}, [], '', {'version': 1}])
def test_malformed_record_fails_closed(tmp_path, replacement):
    path, image, _, _, _ = candidate(tmp_path)
    review.write_json(review.sidecar(image), replacement)
    assert not review.validate(path, image)['ok']


@pytest.mark.parametrize('text', [['Write check'], ['Write check', 'Stop before saving', 'Stop before saving'],
                                  ['Write cheque', 'Stop before saving'], 'Write check', [], [None]])
def test_pixel_transcription_rejects_omissions_duplicates_typos(tmp_path, text):
    path, image, _, _, record = candidate(tmp_path)
    record['observed_text'] = text
    review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']


def test_text_grouping_allows_only_whitespace_changes(tmp_path):
    path, image, _, _, record = candidate(tmp_path)
    record['observed_text'] = ['Write\ncheck', 'Stop  before saving']
    review.write_json(review.sidecar(image), record)
    assert review.validate(path, image)['ok']
    assert not review.validate(path, image, 'A different alt')['ok']
    with pytest.raises(SystemExit, match='Alt text differs'):
        review.enforce(path, [(image, None)])


@pytest.mark.parametrize('field,value', [('generator', 'legacy'), ('post_anchor', 'wrong post'), ('visual_claim', ''),
                                        ('prompt', ''), ('alt_text', ''), ('exact_text', [])])
def test_receipt_requires_relevance_and_complete_copy(tmp_path, field, value):
    path, image, receipt, _, record = candidate(tmp_path)
    data = review.read_json(receipt)
    data[field] = value
    review.write_json(receipt, data)
    record['context']['receipt'] = [post_review.snapshot(receipt)]
    review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']


@pytest.mark.parametrize('kind', ['not_png', 'truncated', 'landscape', 'small'])
def test_bad_export_blocked(tmp_path, kind):
    path, image, _, _, _ = candidate(tmp_path)
    if kind == 'not_png':
        image.write_bytes(b'not a png')
    elif kind == 'truncated':
        image.write_bytes(image.read_bytes()[:20])
    else:
        png(image, *( (1280, 1024) if kind == 'landscape' else (400, 500)))
    assert not review.validate(path, image)['ok']


def test_image_bytes_rename_and_missing_review_block(tmp_path):
    path, image, _, _, _ = candidate(tmp_path)
    image.write_bytes(image.read_bytes() + b'changed')
    with pytest.raises(SystemExit, match='Image changed'):
        review.enforce(path, [(image, 'A check before a write.')])
    other = tmp_path / 'renamed.png'
    other.write_bytes(image.read_bytes())
    with pytest.raises(SystemExit, match='missing from visual inventory'):
        review.enforce(path, [(other, 'A check before a write.')])
    review.sidecar(image).unlink()
    with pytest.raises(SystemExit, match='missing/malformed'):
        review.enforce(path, [(image, 'A check before a write.')])


def test_origin_registration_before_generation_and_no_downgrade(tmp_path):
    path = tmp_path / 'post.md'
    image = tmp_path / 'future.png'
    review.register(path, image)
    assert review.inventory(path)['images'][str(image)] == review.GENERATOR
    with pytest.raises(ValueError, match='cannot change'):
        review.register(path, image, 'legacy')
    with pytest.raises(ValueError, match='Invalid visual origin'):
        review.register(path, image, 'unknown')
    native = tmp_path / 'native.png'
    review.register(path, native, 'native')
    review.enforce(path, [(native, '')])
    review.enforce(path, [])


@pytest.mark.parametrize('data', [{'version': 2, 'images': {'/x': 'native'}}, {'version': 1, 'images': []},
                                  {'version': 1, 'images': {}}, {'version': 1, 'images': {'x': 'native'}},
                                  {'version': 1, 'images': {'/x': 'unknown'}}, None])
def test_malformed_inventory_never_downgrades_to_legacy(tmp_path, data):
    path = tmp_path / 'post.md'
    review.write_json(review.manifest(path), data)
    with pytest.raises(SystemExit, match='visual review blocked'):
        review.enforce(path, [(tmp_path / 'x.png', '')])


def test_legacy_untouched_but_retained_markers_require_review(tmp_path):
    path = tmp_path / 'post.md'
    image = tmp_path / 'old-generated-v2.png'
    review.enforce(path, [(image, '')])
    (tmp_path / 'old.image.json').write_text('{}')
    with pytest.raises(SystemExit, match='visual review blocked'):
        review.enforce(path, [(image, '')])


def test_deleted_inventory_still_recognizes_review_marker(tmp_path):
    path, image, receipt, _, _ = candidate(tmp_path)
    review.manifest(path).unlink()
    receipt.unlink()
    with pytest.raises(SystemExit, match='visual review blocked'):
        review.enforce(path, [(image, 'A check before a write.')])


def test_post_editorial_review_is_not_optional(tmp_path):
    path, image, _, _, _ = candidate(tmp_path)
    text_report = review.read_json(post_review.sidecar(path))
    Path(text_report['context']['voice'][0]['path']).write_text('changed voice')
    result = review.validate(path, image)
    assert any('current passing text review' in e for e in result['errors'])


def test_cli_register_prepare_check_and_errors(tmp_path, capsys):
    path, image, receipt, brand, _ = candidate(tmp_path)
    argv = ['--file', str(path), '--image', str(image)]
    assert review.main(['check', *argv]) == 0
    assert 'Visual review passed' in capsys.readouterr().out
    assert review.main(['register', *argv]) == 0
    assert review.main(['prepare', *argv, '--receipt', str(receipt), '--brand', str(brand), '--evidence', str(brand)]) == 0
    assert review.main(['check', *argv]) == 2
    assert 'Visual review passed' not in capsys.readouterr().out
    assert review.main(['prepare', *argv]) == 2


@pytest.mark.parametrize('source_outcome', ['fail', 'change'])
def test_cli_live_sources_and_concurrent_asset_change(tmp_path, monkeypatch, capsys, source_outcome):
    path, image, _, _, _ = candidate(tmp_path)
    def sources(p):
        if source_outcome == 'change':
            image.write_bytes(image.read_bytes() + b'new candidate')
            return {'ok': True}
        return {'ok': False, 'reason': 'offline'}
    monkeypatch.setattr(post_review.verify_sources, 'verify', sources)
    assert review.main(['check', '--file', str(path), '--image', str(image)]) == 2
    assert 'Visual review passed' not in capsys.readouterr().out


@pytest.mark.parametrize('state', ['pass', 'missing', 'fail', 'stale', 'alt', 'source_race'])
@pytest.mark.parametrize('mode', ['publish', 'dry-run', 'draft-only'])
def test_publisher_blocks_before_disclosure_or_upload(tmp_path, monkeypatch, capsys, state, mode):
    if post_review.PLATFORM == 'linkedin' and mode == 'draft-only':
        pytest.skip('LinkedIn has no draft-only operation')
    path, image, _, _, record = candidate(tmp_path)
    calls = []
    alt = 'A check before a write.'
    if state == 'missing':
        review.sidecar(image).unlink()
    elif state == 'fail':
        record['checks']['composition']['status'] = 'fail'
        review.write_json(review.sidecar(image), record)
    elif state == 'stale':
        image.write_bytes(image.read_bytes() + b'edit')
    elif state == 'alt':
        alt = 'Unreviewed alt'
    argv = ['post', '--file', str(path), '--image', str(image), '--alt', alt, '--allow-unverified']
    if post_review.PLATFORM == 'linkedin':
        import linkedin_post as publisher
        monkeypatch.setattr(publisher, 'load_env', lambda: {'LINKEDIN_PERSON_URN': 'person'})
        monkeypatch.setattr(publisher, 'warn_if_token_expiring', lambda e: None)
        monkeypatch.setattr(publisher, 'warn_publish_conditions', lambda: None)
        monkeypatch.setattr(publisher, 'publish', lambda *a: calls.append('publish'))
        monkeypatch.setattr(publisher, 'initialize_image_upload', lambda *a: (calls.append('upload'), 'image'))
        monkeypatch.setattr(publisher, 'upload_file_bytes', lambda *a: None)
        argv.append('--allow-ai-tells')
    else:
        import typefully_post as publisher
        monkeypatch.setattr(publisher, 'load_env', lambda *a: {})
        monkeypatch.setattr(publisher, 'require_setup', lambda e: 'social')
        monkeypatch.setattr(publisher, 'publish_draft', lambda *a, **kw: calls.append('publish') or {'id': 1, 'private_url': 'url'})
        monkeypatch.setattr(publisher, 'upload_media', lambda *a: calls.append('upload') or 'image')
    if state == 'source_race':
        monkeypatch.setattr(publisher, 'enforce_source_gate', lambda *a: image.write_bytes(image.read_bytes() + b'edit'))
    if mode != 'publish':
        argv.append('--' + mode)
    monkeypatch.setattr(sys, 'argv', argv)
    if state == 'pass' or (state == 'source_race' and mode == 'dry-run'):
        publisher.main()
        assert calls == ([] if mode == 'dry-run' else ['upload', 'publish'])
    else:
        with pytest.raises(SystemExit, match='visual review blocked'):
            publisher.main()
        assert calls == []
        assert 'DRY RUN' not in capsys.readouterr().out


@pytest.mark.parametrize('size', [(1200, 1500), (1201, 1500), (2400, 3000)])
def test_aspect_rounding_is_allowed_only_above_export_minimum(tmp_path, size):
    image = png(tmp_path / 'rounding.png', *size)
    assert review.png_size(image) == list(size)


@pytest.mark.parametrize('size', [(1122, 1402), (1024, 1280), (1199, 1500), (1200, 1499)])
def test_undersized_native_exports_cannot_use_aspect_tolerance(tmp_path, size):
    # 1122x1402 was accepted in a real run despite the intended 1200x1500 export.
    image = png(tmp_path / 'undersized.png', *size)
    with pytest.raises(ValueError, match='at least 1200 by 1500'):
        review.png_size(image)


def test_frozen_rejected_export(tmp_path):
    observation = review.read_json(ROOT / 'evals/baseline/visual-quality/export-observation.json')
    image = tmp_path / 'observed.png'
    image.write_bytes(bytes.fromhex(observation['native_header_hex']))
    assert struct.unpack('>II', image.read_bytes()[16:24]) == (1122, 1402)
    with pytest.raises(ValueError, match='at least 1200 by 1500'):
        review.png_size(image)
    # Synthetic positive boundary checks the export contract, not this artwork's craft.
    png(image, *observation['requested_minimum'])
    assert review.png_size(image) == [1200, 1500]


@pytest.mark.parametrize('export', [None, {}, [], {'min_width': True, 'min_height': 1500},
                                   {'min_width': 1122, 'min_height': 1402},
                                   {'min_width': 1200, 'min_height': '1500'}])
def test_missing_or_lowered_export_contract_blocks(tmp_path, export):
    path, image, receipt, brand, record = candidate(tmp_path)
    data = review.read_json(receipt)
    data['export'] = export
    review.write_json(receipt, data)
    record['context']['receipt'] = [post_review.snapshot(receipt)]
    review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']
    with pytest.raises((ValueError, KeyError, TypeError)):
        review.prepare(path, image, receipt, [brand], [brand])


def test_larger_declared_export_minimum_is_enforced(tmp_path):
    path, image, receipt, brand, record = candidate(tmp_path)
    data = review.read_json(receipt)
    data['export'] = {'min_width': 2400, 'min_height': 3000}
    review.write_json(receipt, data)
    record['context']['receipt'] = [post_review.snapshot(receipt)]
    review.write_json(review.sidecar(image), record)
    assert not review.validate(path, image)['ok']
    with pytest.raises(ValueError, match='at least 2400 by 3000'):
        review.prepare(path, image, receipt, [brand], [brand])
    png(image, 2400, 3000)
    record['image'] = post_review.snapshot(image)
    record['dimensions'] = [2400, 3000]
    review.write_json(review.sidecar(image), record)
    assert review.validate(path, image)['ok']


@pytest.mark.parametrize('field', ['finish', 'focal_idea', 'reference_basis'])
def test_quality_brief_cannot_be_empty(tmp_path, field):
    path, image, receipt, _, record = candidate(tmp_path)
    data = review.read_json(receipt)
    data['quality_brief'][field] = ''
    review.write_json(receipt, data)
    record['context']['receipt'] = [post_review.snapshot(receipt)]
    review.write_json(review.sidecar(image), record)
    assert f'Missing visual quality brief: {field}' in review.validate(path, image)['errors']


@pytest.mark.parametrize('decision', [True, None, 'false', 0])
def test_craft_revision_blocks_even_with_twelve_passing_rows(tmp_path, decision):
    path, image, _, _, record = candidate(tmp_path)
    record['revision_required'] = decision
    review.write_json(review.sidecar(image), record)
    with pytest.raises(SystemExit, match='craft revision is required or undecided'):
        review.enforce(path, [(image, 'A check before a write.')])


@pytest.mark.parametrize('kind', ['header', 'dimensions', 'extension', 'truncated'])
def test_prepare_rejects_invalid_exports(tmp_path, kind):
    path, image, receipt, brand, _ = candidate(tmp_path)
    if kind == 'header':
        image.write_bytes(b'not PNG')
    elif kind == 'dimensions':
        png(image, 1280, 1024)
    elif kind == 'extension':
        renamed = image.with_suffix('.pdf')
        image.rename(renamed)
        image = renamed
    else:
        image.write_bytes(image.read_bytes()[:20])
    with pytest.raises((ValueError, struct.error)):
        review.prepare(path, image, receipt, [brand], [brand])


@pytest.mark.parametrize('index', [None, True, 0, 2])
def test_x_receipt_requires_target_tweet(tmp_path, monkeypatch, index):
    monkeypatch.setattr(post_review, 'PLATFORM', 'x')
    path, image, receipt, _, record = candidate(tmp_path)
    data = review.read_json(receipt)
    data['tweet_index'] = index
    review.write_json(receipt, data)
    record['context']['receipt'] = [post_review.snapshot(receipt)]
    review.write_json(review.sidecar(image), record)
    result = review.validate(path, image)
    assert any('tweet_index' in e for e in result['errors'])


def test_x_image_cannot_move_to_a_different_tweet(tmp_path, monkeypatch):
    monkeypatch.setattr(post_review, 'PLATFORM', 'x')
    path, image, _, _, _ = candidate(tmp_path)
    result = review.validate(path, image, 'A check before a write.', 2)
    assert any('accompany the tweet' in e for e in result['errors'])


@pytest.mark.parametrize('origin', ['codex-imagegen', 'legacy'])
@pytest.mark.parametrize('mode', ['dry-run', 'publish'])
def test_linkedin_document_does_not_bypass_generated_asset_review(tmp_path, monkeypatch, capsys, origin, mode):
    if post_review.PLATFORM != 'linkedin':
        pytest.skip('LinkedIn document publishing only')
    import linkedin_post as publisher
    path, _, _, _, _ = candidate(tmp_path)
    pdf = tmp_path / 'document.pdf'
    pdf.write_bytes(b'%PDF-1.4 synthetic protocol fixture')
    review.register(path, pdf, origin)
    calls = []
    monkeypatch.setattr(publisher, 'load_env', lambda: {'LINKEDIN_PERSON_URN': 'person'})
    monkeypatch.setattr(publisher, 'warn_if_token_expiring', lambda e: None)
    monkeypatch.setattr(publisher, 'warn_publish_conditions', lambda: None)
    monkeypatch.setattr(publisher, 'publish', lambda *a: calls.append('publish'))
    monkeypatch.setattr(publisher, 'initialize_document_upload', lambda *a: (calls.append('upload'), 'document'))
    monkeypatch.setattr(publisher, 'upload_file_bytes', lambda *a: None)
    argv = ['post', '--file', str(path), '--document', str(pdf), '--allow-unverified', '--allow-ai-tells']
    if mode == 'dry-run':
        argv.append('--dry-run')
    monkeypatch.setattr(sys, 'argv', argv)
    if origin == 'codex-imagegen':
        with pytest.raises(SystemExit, match='visual review blocked'):
            publisher.main()
        assert calls == [] and 'DRY RUN' not in capsys.readouterr().out
    else:
        publisher.main()
        assert calls == ([] if mode == 'dry-run' else ['upload', 'publish'])
