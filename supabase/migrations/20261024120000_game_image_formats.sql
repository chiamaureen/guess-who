BEGIN;

CREATE FUNCTION public.game_engine_webp_valid(p_image bytea)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  image_size integer := octet_length(p_image);
  riff_size bigint;
  chunk_size bigint;
  image_width integer;
  image_height integer;
BEGIN
  IF image_size < 30 OR image_size > 307200
    OR substring(p_image FROM 1 FOR 4) <> decode('52494646','hex')
    OR substring(p_image FROM 9 FOR 8) <> decode('5745425056503820','hex') THEN RETURN false; END IF;
  riff_size := get_byte(p_image,4)::bigint + get_byte(p_image,5)*256 + get_byte(p_image,6)*65536 + get_byte(p_image,7)::bigint*16777216;
  chunk_size := get_byte(p_image,16)::bigint + get_byte(p_image,17)*256 + get_byte(p_image,18)*65536 + get_byte(p_image,19)::bigint*16777216;
  IF riff_size+8 <> image_size OR chunk_size < 10 OR 20+chunk_size+(chunk_size%2) <> image_size
    OR (get_byte(p_image,20)&1) <> 0 OR substring(p_image FROM 24 FOR 3) <> decode('9d012a','hex')
    OR (chunk_size%2=1 AND get_byte(p_image,image_size-1)<>0) THEN RETURN false; END IF;
  image_width := (get_byte(p_image,26)+get_byte(p_image,27)*256)&16383;
  image_height := (get_byte(p_image,28)+get_byte(p_image,29)*256)&16383;
  RETURN image_width BETWEEN 1 AND 1024 AND image_height BETWEEN 1 AND 1024;
END;
$function$;

CREATE FUNCTION public.game_engine_jpeg_valid(p_image bytea)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  image_size integer := octet_length(p_image);
  cursor_position integer := 2;
  marker integer;
  segment_size integer;
  image_width integer;
  image_height integer;
  has_frame boolean := false;
  has_scan boolean := false;
BEGIN
  IF image_size < 20 OR image_size > 524288 OR substring(p_image FROM 1 FOR 2)<>decode('ffd8','hex') THEN RETURN false; END IF;
  WHILE cursor_position+1 < image_size LOOP
    IF get_byte(p_image,cursor_position)<>255 THEN RETURN false; END IF;
    marker := get_byte(p_image,cursor_position+1);
    IF marker=217 THEN RETURN has_frame AND has_scan AND cursor_position+2=image_size; END IF;
    IF marker NOT IN (192,194,196,219,221,218) OR cursor_position+4>image_size THEN RETURN false; END IF;
    segment_size := get_byte(p_image,cursor_position+2)*256+get_byte(p_image,cursor_position+3);
    IF segment_size<2 OR cursor_position+2+segment_size>image_size THEN RETURN false; END IF;
    IF marker IN (192,194) THEN
      IF has_frame OR segment_size<8 OR get_byte(p_image,cursor_position+4)<>8 THEN RETURN false; END IF;
      image_height := get_byte(p_image,cursor_position+5)*256+get_byte(p_image,cursor_position+6);
      image_width := get_byte(p_image,cursor_position+7)*256+get_byte(p_image,cursor_position+8);
      IF image_width NOT BETWEEN 1 AND 1600 OR image_height NOT BETWEEN 1 AND 1600 THEN RETURN false; END IF;
      has_frame := true;
    END IF;
    cursor_position := cursor_position+2+segment_size;
    IF marker=218 THEN
      IF NOT has_frame THEN RETURN false; END IF;
      has_scan := true;
      WHILE cursor_position+1<image_size LOOP
        IF get_byte(p_image,cursor_position)=255 THEN
          marker := get_byte(p_image,cursor_position+1);
          IF marker=0 OR marker BETWEEN 208 AND 215 THEN cursor_position := cursor_position+2;
          ELSE EXIT; END IF;
        ELSE cursor_position := cursor_position+1; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN false;
END;
$function$;

CREATE FUNCTION public.game_engine_image_valid(p_image bytea)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT public.game_engine_png_valid(p_image) OR public.game_engine_webp_valid(p_image) OR public.game_engine_jpeg_valid(p_image);
$function$;

ALTER TABLE public.game_image_assets DROP CONSTRAINT game_image_assets_png_check;
ALTER TABLE public.game_image_assets ADD CONSTRAINT game_image_assets_image_check CHECK (public.game_engine_image_valid(png));

REVOKE ALL ON FUNCTION public.game_engine_webp_valid(bytea), public.game_engine_jpeg_valid(bytea), public.game_engine_image_valid(bytea) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_engine_webp_valid(bytea), public.game_engine_jpeg_valid(bytea), public.game_engine_image_valid(bytea) TO service_role;

COMMIT;

