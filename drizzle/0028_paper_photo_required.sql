ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_paper_photo_required" CHECK (vote_type != 'paper' OR paper_photo_url IS NOT NULL) NOT VALID;
