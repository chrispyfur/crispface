#!/usr/bin/env python3
"""One-time migration: move faces and watches from shared dirs to per-user dirs.

Moves data/faces/*.json  -> data/users/admin/faces/
Moves data/watches/*.json -> data/users/admin/watches/

Idempotent: skips files that already exist at the destination.
"""
import os
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

OLD_FACES = os.path.join(DATA_DIR, 'faces')
OLD_WATCHES = os.path.join(DATA_DIR, 'watches')

NEW_FACES = os.path.join(DATA_DIR, 'users', 'admin', 'faces')
NEW_WATCHES = os.path.join(DATA_DIR, 'users', 'admin', 'watches')


def migrate_dir(src, dst, label):
    os.makedirs(dst, exist_ok=True)
    if not os.path.isdir(src):
        print(f'  {label}: source dir {src} does not exist, skipping')
        return
    moved = 0
    skipped = 0
    for fname in os.listdir(src):
        if not fname.endswith('.json'):
            continue
        src_path = os.path.join(src, fname)
        dst_path = os.path.join(dst, fname)
        if os.path.exists(dst_path):
            skipped += 1
            continue
        shutil.move(src_path, dst_path)
        moved += 1
    print(f'  {label}: moved {moved}, skipped {skipped} (already existed)')


if __name__ == '__main__':
    print('CrispFace migration: shared -> per-user data')
    migrate_dir(OLD_FACES, NEW_FACES, 'faces')
    migrate_dir(OLD_WATCHES, NEW_WATCHES, 'watches')
    print('Done.')
